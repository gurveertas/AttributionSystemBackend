/**
 * Connector Webhook Controllers
 *
 * Each connector:
 * 1. Verifies the webhook signature
 * 2. Saves the raw payload to RawEvent (before any processing)
 * 3. Normalizes the payload to a canonical event
 * 4. Delegates to the order/booking ingestion logic
 *
 * Auth: Each connector uses its own secret stored on the Connector record.
 * The route receives ?connectorId=<id> or a path param, then we look up
 * the connector and verify against its stored secret.
 *
 * Provider secrets are loaded from encrypted connector storage.
 */

import crypto from "crypto";
import { db } from "../src/prisma/db.js";
import { createOrder } from "./orderController.js";
import { createBooking } from "./bookingController.js";
import { createRefund } from "./refundController.js";
import {
    getConnectorConfig,
    getNestedValue,
    getRawBody,
    ingestMappedOrder,
    verifyHmacSignature,
} from "../utils/connectorConfig.js";

const orm = () => db.orm.public;

// ── Helpers ──────────────────────────────────────────────────────────────────

function verifyStripeSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const fields = signatureHeader.split(",").map((part) => part.split("=", 2));
    const timestamp = fields.find(([key]) => key === "t")?.[1];
    const signatures = fields
        .filter(([key]) => key === "v1")
        .map(([, value]) => value);
    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) ||
        Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${rawBody}`)
        .digest();
    return signatures.some((signature) => {
        const received = Buffer.from(signature, "hex");
        return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    });
}

function captureControllerResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function assertControllerSucceeded(response, operation) {
    if (response.statusCode >= 400) {
        throw new Error(`${operation} failed (${response.statusCode}): ${response.body?.message ?? "unknown error"}`);
    }
}

async function saveRawEvent(workspaceId, connectorId, source, eventType, payload) {
    try {
        return await orm().RawEvent.create({
            workspaceId,
            connectorId,
            source,
            eventType,
            payload,
            status: "pending",
        });
    } catch (err) {
        console.error("saveRawEvent error:", err.message);
        return null;
    }
}

async function markRawEvent(rawEventId, status, error = null) {
    if (!rawEventId) return;
    try {
        await orm().RawEvent.where({ id: rawEventId }).update({
            status,
            error: error ? String(error).slice(0, 500) : null,
            processedAt: new Date().toISOString(),
        });
    } catch { /* non-critical */ }
}

async function lookupConnector(connectorId, workspaceId) {
    const connector = await orm().Connector.where({ id: connectorId }).first();
    if (!connector) return null;
    if (workspaceId && connector.workspaceId !== workspaceId) return null;
    return connector;
}

// ── Stripe ───────────────────────────────────────────────────────────────────

/**
 * POST /api/connectors/stripe/webhook
 * Headers: stripe-signature
 * Query:   connectorId
 *
 */
export const stripeWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId query param required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (connector.type !== "stripe") return res.status(400).json({ message: "Connector is not configured for Stripe" });

    const workspaceId = connector.workspaceId;
    const rawBody = getRawBody(req);
    const sig = req.headers["stripe-signature"];

    const config = getConnectorConfig(connector);
    const webhookSecret = config.webhookSecret;
    if (!webhookSecret) return res.status(500).json({ message: "Connector is missing webhookSecret in config" });

    let event;
    if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
        return res.status(400).json({ message: "Invalid or expired Stripe signature" });
    }
    try {
        event = JSON.parse(rawBody);
    } catch {
        return res.status(400).json({ message: "Invalid JSON webhook payload" });
    }

    const rawEvent = await saveRawEvent(workspaceId, connectorId, "stripe", event.type, event);

    // Update connector lastEventAt
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    // Normalize and ingest
    try {
        let orderResult = null;
        let refundResult = null;
        if (event.type === "payment_intent.succeeded" || event.type === "charge.succeeded") {
            const pi = event.data.object;
            const checkoutToken = pi.metadata?.attribution_token || pi.metadata?.checkout_token || null;
            const email = pi.receipt_email || pi.metadata?.email || null;
            const externalId = event.type === "charge.succeeded"
                ? pi.payment_intent || pi.id
                : pi.id;
            const amountReceived = pi.amount_received ?? pi.amount_captured ?? pi.amount;

            // Synthesize req/res for createOrder
            const fakeReq = {
                workspaceId,
                body: {
                    externalId,
                    orderedAt: new Date(pi.created * 1000).toISOString(),
                    currency: (pi.currency || "usd").toUpperCase(),
                    grossAmount: pi.amount / 100,
                    netAmount: amountReceived / 100,
                    checkoutToken,
                    email,
                    connectorId,
                    idempotencyKey: externalId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createOrder(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Stripe order ingestion");
            orderResult = fakeRes.body;

        } else if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
        ) {
            const session = event.data.object;
            if (session.payment_status === "paid") {
                const paymentIntentId = typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : session.payment_intent?.id;
                const checkoutToken = session.metadata?.attribution_token
                    || session.metadata?.checkout_token
                    || session.client_reference_id
                    || null;
                const amount = (session.amount_total ?? 0) / 100;
                const fakeReq = {
                    workspaceId,
                    body: {
                        externalId: paymentIntentId || session.id,
                        orderedAt: new Date(session.created * 1000).toISOString(),
                        currency: (session.currency || "usd").toUpperCase(),
                        grossAmount: amount,
                        netAmount: amount,
                        checkoutToken,
                        email: session.customer_details?.email || session.customer_email || null,
                        connectorId,
                        idempotencyKey: paymentIntentId || session.id,
                    },
                    ip: null,
                    headers: {},
                    apiKey: {},
                };
                const fakeRes = captureControllerResponse();
                await createOrder(fakeReq, fakeRes);
                assertControllerSucceeded(fakeRes, "Stripe order ingestion");
                orderResult = fakeRes.body;
            }

        } else if (event.type === "charge.refunded") {
            const charge = event.data.object;
            const lastRefund = charge.refunds?.data?.[0];
            if (lastRefund) {
                const fakeReq = {
                    workspaceId,
                    body: {
                        externalOrderId: charge.payment_intent || charge.id,
                        amount: lastRefund.amount / 100,
                        currency: (lastRefund.currency || "usd").toUpperCase(),
                        externalId: lastRefund.id,
                        refundedAt: new Date(lastRefund.created * 1000).toISOString(),
                    },
                    ip: null,
                    headers: {},
                };
                const fakeRes = captureControllerResponse();
                await createRefund(fakeReq, fakeRes);
                assertControllerSucceeded(fakeRes, "Stripe refund ingestion");
                refundResult = fakeRes.body;
            }
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
            ...(refundResult ? { refund: refundResult } : {}),
        });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        // Update connector error count
        void orm().Connector.where({ id: connectorId }).update({
            errorCount: (connector.errorCount || 0) + 1,
            lastError: err.message.slice(0, 500),
            lastErrorAt: new Date().toISOString(),
            status: "failing",
        }).catch(() => {});
        console.error("stripeWebhook processing error:", err.message);
        return res.status(500).json({ message: "Event processing failed" });
    }
};

// ── Shopify ──────────────────────────────────────────────────────────────────

/**
 * POST /api/connectors/shopify/webhook
 * Headers: X-Shopify-Hmac-Sha256, X-Shopify-Topic
 * Query:   connectorId
 */
export const shopifyWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (connector.type !== "shopify") return res.status(400).json({ message: "Connector is not configured for Shopify" });

    const workspaceId = connector.workspaceId;
    const config = getConnectorConfig(connector);
    const sharedSecret = config.sharedSecret || config.webhookSecret;

    if (!sharedSecret) {
        return res.status(500).json({ message: "Connector is missing sharedSecret in config" });
    }
    if (!verifyHmacSignature({
        secret: sharedSecret,
        signature: req.headers["x-shopify-hmac-sha256"],
        payload: getRawBody(req),
        encoding: "base64",
    })) {
        return res.status(401).json({ message: "Invalid Shopify HMAC signature" });
    }

    const topic = req.headers["x-shopify-topic"] || "";
    const payload = req.body;
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "shopify", topic, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        let orderResult = null;
        let refundResult = null;
        if (topic === "orders/paid" || topic === "orders/create") {
            const order = payload;
            const attributes = [...(order.cart_attributes || []), ...(order.note_attributes || [])];
            const checkoutToken = attributes.find(a =>
                ["attribution_token", "checkout_token"].includes(a.name)
            )?.value || null;
            const email = order.email || order.customer?.email || null;
            const phone = order.phone || order.billing_address?.phone || null;

            const fakeReq = {
                workspaceId,
                body: {
                    externalId: String(order.id),
                    orderedAt: order.processed_at || order.created_at,
                    currency: order.currency,
                    grossAmount: parseFloat(order.total_price || 0),
                    netAmount: parseFloat(order.subtotal_price || order.total_price || 0),
                    discountAmount: parseFloat(order.total_discounts || 0),
                    taxAmount: parseFloat(order.total_tax || 0),
                    checkoutToken,
                    email,
                    phone,
                    connectorId,
                    items: (order.line_items || []).map(li => ({
                        name: li.name,
                        quantity: li.quantity,
                        unitAmount: parseFloat(li.price || 0),
                        currency: order.currency,
                        externalId: String(li.id),
                    })),
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createOrder(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Shopify order ingestion");
            orderResult = fakeRes.body;

        } else if (topic === "refunds/create") {
            const refund = payload;
            const fakeReq = {
                workspaceId,
                body: {
                    externalOrderId: String(refund.order_id),
                    amount: parseFloat(refund.transactions?.[0]?.amount || 0),
                    currency: refund.transactions?.[0]?.currency || "USD",
                    externalId: String(refund.id),
                    refundedAt: refund.created_at,
                    reason: refund.note,
                },
                ip: null,
                headers: {},
            };
            const fakeRes = captureControllerResponse();
            await createRefund(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Shopify refund ingestion");
            refundResult = fakeRes.body;
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
            ...(refundResult ? { refund: refundResult } : {}),
        });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("shopifyWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};

// ── Zenoti ───────────────────────────────────────────────────────────────────

/**
 * POST /api/connectors/zenoti/webhook
 * Query: connectorId
 * Zenoti sends appointment/invoice/guest events.
 */
export const zenotiWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (connector.type !== "zenoti") return res.status(400).json({ message: "Connector is not configured for Zenoti" });

    const workspaceId = connector.workspaceId;
    const config = getConnectorConfig(connector);
    if (!config.webhookSecret) {
        return res.status(500).json({ message: "Connector is missing webhookSecret in config" });
    }
    if (!verifyHmacSignature({
        secret: config.webhookSecret,
        signature: req.headers["x-zenoti-signature"],
        payload: getRawBody(req),
        encoding: config.signatureEncoding || "hex",
        prefix: config.signaturePrefix || "",
    })) {
        return res.status(401).json({ message: "Invalid Zenoti signature" });
    }

    const payload = req.body;
    const eventType = payload?.event_type || payload?.type || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "zenoti", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        let orderResult = null;
        let bookingResult = null;
        if (eventType === "appointment.created" || eventType === "appointment.booked") {
            const appt = payload.appointment || payload;
            const guest = appt.guest || {};
            const checkoutToken = appt.notes?.match(/attribution_token:([a-f0-9-]+)/)?.[1] || null;

            const fakeReq = {
                workspaceId,
                body: {
                    externalId: String(appt.id || appt.appointment_id),
                    appointmentStartAt: appt.start_time || appt.appointment_date,
                    currency: connector.config?.currency || "USD",
                    bookedValue: parseFloat(appt.price || appt.total || 0),
                    checkoutToken,
                    email: guest.email || null,
                    phone: guest.mobile || guest.phone || null,
                    serviceName: appt.service?.name || appt.service_name || null,
                    connectorId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createBooking(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Zenoti booking ingestion");
            bookingResult = fakeRes.body;

        } else if (eventType === "invoice.completed" || eventType === "invoice.paid") {
            const invoice = payload.invoice || payload;
            const guest = invoice.guest || {};

            const fakeReq = {
                workspaceId,
                body: {
                    externalId: String(invoice.id || invoice.invoice_id),
                    orderedAt: invoice.payment_date || invoice.date || new Date().toISOString(),
                    currency: connector.config?.currency || "USD",
                    grossAmount: parseFloat(invoice.total || 0),
                    netAmount: parseFloat(invoice.sub_total || invoice.total || 0),
                    discountAmount: parseFloat(invoice.discount || 0),
                    taxAmount: parseFloat(invoice.tax || 0),
                    email: guest.email || null,
                    phone: guest.mobile || guest.phone || null,
                    connectorId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createOrder(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Zenoti order ingestion");
            orderResult = fakeRes.body;
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
            ...(bookingResult ? { booking: bookingResult } : {}),
        });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("zenotiWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};

// ── Razorpay ─────────────────────────────────────────────────────────────────

/**
 * POST /api/connectors/razorpay/webhook
 * Headers: X-Razorpay-Signature
 */
export const razorpayWebhook = async (req, res) => {
    const connectorId = req.query.connectorId; //
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (connector.type !== "razorpay") return res.status(400).json({ message: "Connector is not configured for Razorpay" });

    const workspaceId = connector.workspaceId;
    const config = getConnectorConfig(connector);
    const webhookSecret = config.webhookSecret;
    if (!webhookSecret) {
        return res.status(500).json({ message: "Connector is missing webhookSecret in config" });
    }
    if (!verifyHmacSignature({
        secret: webhookSecret,
        signature: req.headers["x-razorpay-signature"],
        payload: getRawBody(req),
        encoding: "hex",
    })) {
        return res.status(401).json({ message: "Invalid Razorpay signature" });
    }

    const payload = req.body;

    const eventType = payload?.event || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "razorpay", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        let orderResult = null;
        if (eventType === "payment.captured" || eventType === "order.paid") {
            const payment = payload.payload?.payment?.entity || {};
            const checkoutToken = payment.notes?.attribution_token
                || payment.notes?.checkout_token
                || payment.notes?.sessionToken
                || null;
            const email = payment.email || null;
            const phone = payment.contact || null;

            const fakeReq = {
                workspaceId,
                body: {
                    externalId: payment.id || payment.order_id,
                    orderedAt: new Date((payment.created_at || Date.now() / 1000) * 1000).toISOString(),
                    currency: (payment.currency || "INR").toUpperCase(),
                    grossAmount: (payment.amount || 0) / 100,
                    netAmount: (payment.amount || 0) / 100,
                    checkoutToken,
                    email,
                    phone,
                    connectorId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createOrder(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Razorpay order ingestion");
            orderResult = fakeRes.body;
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
        });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("razorpayWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};

// ── PayPal ───────────────────────────────────────────────────────────────────

async function verifyPayPalWebhook(req, config) {
    if (!config.clientId || !config.clientSecret || !config.webhookId) {
        throw new Error("PayPal connector requires clientId, clientSecret, and webhookId");
    }

    const apiBase = config.paypalEnvironment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
    const headers = req.headers;
    const transmission = {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: config.webhookId,
        webhook_event: req.body,
    };
    if (Object.values(transmission).some((value) => !value)) {
        throw new Error("PayPal webhook is missing required signature headers");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
        const tokenResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
            signal: controller.signal,
        });
        if (!tokenResponse.ok) {
            throw new Error(`PayPal OAuth verification failed (${tokenResponse.status})`);
        }
        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) throw new Error("PayPal OAuth response did not include an access token");

        const verificationResponse = await fetch(`${apiBase}/v1/notifications/verify-webhook-signature`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(transmission),
            signal: controller.signal,
        });
        if (!verificationResponse.ok) {
            throw new Error(`PayPal webhook verification failed (${verificationResponse.status})`);
        }
        const verification = await verificationResponse.json();
        return verification.verification_status === "SUCCESS";
    } finally {
        clearTimeout(timeout);
    }
}

export const paypalWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (connector.type !== "paypal") return res.status(400).json({ message: "Connector is not configured for PayPal" });

    let config;
    try {
        config = getConnectorConfig(connector);
    } catch (error) {
        console.error("PayPal webhook verification failed:", error.message);
        return res.status(500).json({ message: "PayPal connector configuration is invalid" });
    }
    if (!config.clientId || !config.clientSecret || !config.webhookId) {
        return res.status(500).json({ message: "PayPal connector requires clientId, clientSecret, and webhookId" });
    }
    const requiredHeaders = [
        "paypal-auth-algo",
        "paypal-cert-url",
        "paypal-transmission-id",
        "paypal-transmission-sig",
        "paypal-transmission-time",
    ];
    if (requiredHeaders.some((header) => !req.headers[header])) {
        return res.status(400).json({ message: "PayPal webhook is missing signature headers" });
    }
    let isValidSignature;
    try {
        isValidSignature = await verifyPayPalWebhook(req, config);
    } catch (error) {
        console.error("PayPal webhook verification failed:", error.message);
        return res.status(503).json({ message: "PayPal signature verification is temporarily unavailable" });
    }
    if (!isValidSignature) return res.status(401).json({ message: "Invalid PayPal webhook signature" });

    const workspaceId = connector.workspaceId;
    const payload = req.body;
    const eventType = payload?.event_type || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "paypal", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        const orderEventTypes = config.orderEventTypes || ["PAYMENT.CAPTURE.COMPLETED"];
        let orderResult = null;
        if (orderEventTypes.includes(eventType)) {
            const resource = payload.resource || {};
            const fieldMap = {
                externalId: "resource.id",
                orderedAt: "resource.create_time",
                currency: "resource.amount.currency_code",
                grossAmount: "resource.amount.value",
                netAmount: "resource.amount.value",
                email: "resource.payer.email_address",
                checkoutToken: "resource.custom_id",
                ...config.fieldMap,
            };
            orderResult = await ingestMappedOrder({
                payload,
                fieldMap,
                connectorId,
                workspaceId,
                req,
                createOrder,
            });
        }
        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
        });
    } catch (error) {
        await markRawEvent(rawEvent?.id, "failed", error.message);
        console.error("paypalWebhook error:", error.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};

// ── Generic REST Webhook ──────────────────────────────────────────────────────

export const genericWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });
    if (!["generic", "woocommerce", "square"].includes(connector.type)) {
        return res.status(400).json({ message: "Connector does not use the configurable HMAC webhook" });
    }

    const workspaceId = connector.workspaceId;
    const config = getConnectorConfig(connector);
    const fieldMap = config.fieldMap || {};

    if (!config.webhookSecret) {
        return res.status(500).json({ message: "Connector is missing webhookSecret in config" });
    }
    const signature = req.headers[String(config.signatureHeader || "x-signature").toLowerCase()];
    const signaturePayload = config.signatureIncludeUrl
        ? `${config.notificationUrl || `${req.protocol}://${req.get("host")}${req.originalUrl}`}${getRawBody(req)}`
        : getRawBody(req);
    if (!verifyHmacSignature({
        secret: config.webhookSecret,
        signature,
        payload: signaturePayload,
        encoding: config.signatureEncoding || "hex",
        prefix: config.signaturePrefix || "",
    })) {
        return res.status(401).json({ message: "Invalid signature" });
    }

    const payload = req.body;
    const eventType = config.eventTypeHeader
        ? req.headers[String(config.eventTypeHeader).toLowerCase()]
        : getNestedValue(payload, config.eventTypeField || "type");
    const resolvedEventType = eventType || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, connector.type, resolvedEventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    const isOrderEvent = (config.orderEventTypes || ["order.paid", "payment.completed"]).includes(resolvedEventType);
    const isBookingEvent = (config.bookingEventTypes || ["booking.created"]).includes(resolvedEventType);

    try {
        let orderResult = null;
        let bookingResult = null;
        if (isOrderEvent) {
            orderResult = await ingestMappedOrder({
                payload,
                fieldMap,
                connectorId,
                workspaceId,
                req,
                createOrder,
            });

        } else if (isBookingEvent) {
            const fakeReq = {
                workspaceId,
                body: {
                    externalId: String(getNestedValue(payload, fieldMap.externalId) || ""),
                    appointmentStartAt: getNestedValue(payload, fieldMap.appointmentStartAt) || new Date().toISOString(),
                    currency: String(getNestedValue(payload, fieldMap.currency) || "USD").toUpperCase(),
                    bookedValue: parseFloat(getNestedValue(payload, fieldMap.bookedValue) || 0),
                    email: getNestedValue(payload, fieldMap.email) || null,
                    phone: getNestedValue(payload, fieldMap.phone) || null,
                    checkoutToken: getNestedValue(payload, fieldMap.checkoutToken) || null,
                    serviceName: getNestedValue(payload, fieldMap.serviceName) || null,
                    connectorId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = captureControllerResponse();
            await createBooking(fakeReq, fakeRes);
            assertControllerSucceeded(fakeRes, "Generic booking ingestion");
            bookingResult = fakeRes.body;
        } else {
            // Unknown event type — just store it, don't fail
            await markRawEvent(rawEvent?.id, "processed");
            return res.status(200).json({ received: true, note: "Unknown event type, stored for replay" });
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({
            received: true,
            ...(orderResult ? { order: orderResult } : {}),
            ...(bookingResult ? { booking: bookingResult } : {}),
        });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("genericWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};
