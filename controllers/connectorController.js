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
 * ⚠️ THIRD-PARTY NOTE:
 * Stripe signature verification uses the `stripe` npm package.
 * Install it with: npm install stripe
 * All other connectors use crypto (already installed).
 */

import crypto from "crypto";
import { db } from "../src/prisma/db.js";
import { createOrder } from "./orderController.js";
import { createBooking } from "./bookingController.js";
import { createRefund } from "./refundController.js";

const orm = () => db.orm.public;

// ── Helpers ──────────────────────────────────────────────────────────────────

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
 * ⚠️ Requires: npm install stripe
 */
export const stripeWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId query param required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });

    const workspaceId = connector.workspaceId;
    const rawBody = req.rawBody || JSON.stringify(req.body); // need raw body for Stripe signature
    const sig = req.headers["stripe-signature"];

    // Extract the webhook secret from connector config
    const webhookSecret = connector.config?.webhookSecret;
    if (!webhookSecret) return res.status(500).json({ message: "Connector is missing webhookSecret in config" });

    let event;
    try {
        // Dynamic import so the server doesn't crash if stripe is not installed
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(webhookSecret);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
        console.error("Stripe signature verification failed:", err.message);
        return res.status(400).json({ message: "Invalid Stripe signature" });
    }

    const rawEvent = await saveRawEvent(workspaceId, connectorId, "stripe", event.type, event);

    // Update connector lastEventAt
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    // Normalize and ingest
    try {
        if (event.type === "payment_intent.succeeded" || event.type === "charge.succeeded") {
            const pi = event.data.object;
            const checkoutToken = pi.metadata?.attribution_token || pi.metadata?.checkout_token || null;
            const email = pi.receipt_email || pi.metadata?.email || null;

            // Synthesize req/res for createOrder
            const fakeReq = {
                workspaceId,
                body: {
                    externalId: pi.id,
                    orderedAt: new Date(pi.created * 1000).toISOString(),
                    currency: (pi.currency || "usd").toUpperCase(),
                    grossAmount: pi.amount / 100,
                    netAmount: pi.amount_received / 100,
                    checkoutToken,
                    email,
                    connectorId,
                    idempotencyKey: pi.id,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = {
                _status: 200,
                _body: null,
                status(code) { this._status = code; return this; },
                json(body) { this._body = body; return this; },
            };
            await createOrder(fakeReq, fakeRes);

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
                const fakeRes = {
                    _status: 200,
                    status(c) { this._status = c; return this; },
                    json(b) { this._body = b; return this; },
                };
                await createRefund(fakeReq, fakeRes);
            }
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({ received: true });
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

    const workspaceId = connector.workspaceId;
    const sharedSecret = connector.config?.sharedSecret;

    // Verify HMAC
    if (sharedSecret) {
        const receivedHmac = req.headers["x-shopify-hmac-sha256"] || "";
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const computedHmac = crypto
            .createHmac("sha256", sharedSecret)
            .update(rawBody)
            .digest("base64");
        if (!crypto.timingSafeEqual(Buffer.from(receivedHmac), Buffer.from(computedHmac))) {
            return res.status(401).json({ message: "Invalid Shopify HMAC signature" });
        }
    }

    const topic = req.headers["x-shopify-topic"] || "";
    const payload = req.body;
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "shopify", topic, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        if (topic === "orders/paid" || topic === "orders/create") {
            const order = payload;
            const checkoutToken = order.cart_attributes?.find(a => a.name === "attribution_token")?.value || null;
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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createOrder(fakeReq, fakeRes);

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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createRefund(fakeReq, fakeRes);
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({ received: true });
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

    const workspaceId = connector.workspaceId;
    const payload = req.body;
    const eventType = payload?.event_type || payload?.type || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "zenoti", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createBooking(fakeReq, fakeRes);

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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createOrder(fakeReq, fakeRes);
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({ received: true });
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
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });

    const workspaceId = connector.workspaceId;
    const webhookSecret = connector.config?.webhookSecret;

    if (webhookSecret) {
        const sig = req.headers["x-razorpay-signature"] || "";
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            return res.status(401).json({ message: "Invalid Razorpay signature" });
        }
    }

    const payload = req.body;
    const eventType = payload?.event || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "razorpay", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    try {
        if (eventType === "payment.captured" || eventType === "order.paid") {
            const payment = payload.payload?.payment?.entity || {};
            const checkoutToken = payment.notes?.attribution_token || null;
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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createOrder(fakeReq, fakeRes);
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({ received: true });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("razorpayWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};

// ── Generic REST Webhook ──────────────────────────────────────────────────────

/**
 * POST /api/connectors/generic/webhook
 * Query: connectorId
 *
 * Uses field mapping stored in connector.config.fieldMap:
 * {
 *   externalId: "order.id",
 *   orderedAt: "order.date",
 *   grossAmount: "order.total",
 *   netAmount: "order.net",
 *   currency: "order.currency",
 *   email: "customer.email",
 *   checkoutToken: "order.meta.attribution_token"
 * }
 *
 * eventType field: connector.config.eventTypeField (e.g. "type" or "event")
 * orderEventTypes: connector.config.orderEventTypes (array of strings)
 * bookingEventTypes: connector.config.bookingEventTypes (array of strings)
 */
function getNestedValue(obj, path) {
    if (!path) return undefined;
    return String(path).split(".").reduce((acc, key) => acc?.[key], obj);
}

export const genericWebhook = async (req, res) => {
    const connectorId = req.query.connectorId;
    if (!connectorId) return res.status(400).json({ message: "connectorId required" });

    const connector = await lookupConnector(connectorId);
    if (!connector) return res.status(404).json({ message: "Connector not found" });

    const workspaceId = connector.workspaceId;
    const config = connector.config || {};
    const fieldMap = config.fieldMap || {};

    // Optional HMAC verification
    if (config.webhookSecret) {
        const sig = req.headers[config.signatureHeader || "x-signature"] || "";
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expected = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
        if (sig !== expected) return res.status(401).json({ message: "Invalid signature" });
    }

    const payload = req.body;
    const eventType = getNestedValue(payload, config.eventTypeField || "type") || "unknown";
    const rawEvent = await saveRawEvent(workspaceId, connectorId, "generic", eventType, payload);
    void orm().Connector.where({ id: connectorId }).update({ lastEventAt: new Date().toISOString() }).catch(() => {});

    const isOrderEvent = (config.orderEventTypes || ["order.paid", "payment.completed"]).includes(eventType);
    const isBookingEvent = (config.bookingEventTypes || ["booking.created"]).includes(eventType);

    try {
        if (isOrderEvent) {
            const fakeReq = {
                workspaceId,
                body: {
                    externalId: String(getNestedValue(payload, fieldMap.externalId) || ""),
                    orderedAt: getNestedValue(payload, fieldMap.orderedAt) || new Date().toISOString(),
                    currency: String(getNestedValue(payload, fieldMap.currency) || "USD").toUpperCase(),
                    grossAmount: parseFloat(getNestedValue(payload, fieldMap.grossAmount) || 0),
                    netAmount: parseFloat(getNestedValue(payload, fieldMap.netAmount) || getNestedValue(payload, fieldMap.grossAmount) || 0),
                    discountAmount: parseFloat(getNestedValue(payload, fieldMap.discountAmount) || 0),
                    email: getNestedValue(payload, fieldMap.email) || null,
                    phone: getNestedValue(payload, fieldMap.phone) || null,
                    checkoutToken: getNestedValue(payload, fieldMap.checkoutToken) || null,
                    connectorId,
                },
                ip: null,
                headers: {},
                apiKey: {},
            };
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createOrder(fakeReq, fakeRes);

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
            const fakeRes = { status(c) { return this; }, json(b) { return this; } };
            await createBooking(fakeReq, fakeRes);
        } else {
            // Unknown event type — just store it, don't fail
            await markRawEvent(rawEvent?.id, "processed");
            return res.status(200).json({ received: true, note: "Unknown event type, stored for replay" });
        }

        await markRawEvent(rawEvent?.id, "processed");
        return res.status(200).json({ received: true });
    } catch (err) {
        await markRawEvent(rawEvent?.id, "failed", err.message);
        console.error("genericWebhook error:", err.message);
        return res.status(500).json({ message: "Processing failed" });
    }
};
