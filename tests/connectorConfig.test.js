import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
    getConnectorConfig,
    ingestMappedOrder,
    prepareConnectorConfig,
    verifyHmacSignature,
} from "../utils/connectorConfig.js";

test("connector configuration encrypts secrets and retains public mapping", () => {
    const stored = prepareConnectorConfig({
        webhookSecret: "hook-secret",
        clientId: "client-id",
        eventTypeField: "type",
    });

    assert.equal(stored.config.eventTypeField, "type");
    assert.equal(Object.hasOwn(stored.config, "webhookSecret"), false);
    assert.equal(Buffer.isBuffer(stored.secretsEnc), true);
    assert.deepEqual(getConnectorConfig({ id: "connector-1", ...stored }), {
        eventTypeField: "type",
        webhookSecret: "hook-secret",
        clientId: "client-id",
    });
});

test("HMAC validation supports hex, base64, prefixes, and rejects mismatches", () => {
    const secret = "provider-secret";
    const payload = '{"type":"payment.completed"}';
    assert.equal(verifyHmacSignature({
        secret,
        payload,
        signature: crypto.createHmac("sha256", secret).update(payload).digest("hex"),
    }), true);
    assert.equal(verifyHmacSignature({
        secret,
        payload,
        signature: `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("base64")}`,
        encoding: "base64",
        prefix: "sha256=",
    }), true);
    assert.equal(verifyHmacSignature({
        secret,
        payload,
        signature: "wrong-signature",
    }), false);
});

test("mapped order ingestion sends normalized checkout attribution fields", async () => {
    let captured;
    await ingestMappedOrder({
        payload: {
            data: {
                id: "order-42",
                created_at: "2025-01-01T12:00:00.000Z",
                amount: { total: "25.50", currency: "usd" },
                attribution_token: "checkout-token",
            },
        },
        fieldMap: {
            externalId: "data.id",
            orderedAt: "data.created_at",
            currency: "data.amount.currency",
            grossAmount: "data.amount.total",
            checkoutToken: "data.attribution_token",
        },
        connectorId: "connector-1",
        workspaceId: "workspace-1",
        req: { headers: {}, ip: null },
        createOrder: async (req, res) => {
            captured = req;
            res.status(201).json({ id: "order-record-1" });
        },
    });

    assert.equal(captured.body.externalId, "order-42");
    assert.equal(captured.body.grossAmount, 25.5);
    assert.equal(captured.body.netAmount, 25.5);
    assert.equal(captured.body.checkoutToken, "checkout-token");
    assert.equal(captured.body.connectorId, "connector-1");
});

test("mapped order ingestion propagates downstream failures", async () => {
    await assert.rejects(
        ingestMappedOrder({
            payload: {
                id: "order-42",
                created_at: "2025-01-01T12:00:00.000Z",
                amount: 25,
                currency: "USD",
            },
            fieldMap: {
                externalId: "id",
                orderedAt: "created_at",
                currency: "currency",
                grossAmount: "amount",
            },
            connectorId: "connector-1",
            workspaceId: "workspace-1",
            req: { headers: {}, ip: null },
            createOrder: async (_req, res) => {
                res.status(422).json({ message: "Invalid order" });
            },
        }),
        /Order ingestion failed \(422\): Invalid order/,
    );
});
