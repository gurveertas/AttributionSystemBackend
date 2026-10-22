import crypto from "crypto";
import { decryptSecret, encryptSecret } from "./crypto.js";

const SECRET_FIELDS = [
    "webhookSecret",
    "sharedSecret",
    "signatureSecret",
    "apiSecret",
    "apiKey",
    "clientSecret",
    "clientId",
    "consumerKey",
    "consumerSecret",
    "accessToken",
    "refreshToken",
    "accessKey",
    "privateKey",
    "password",
    "secret",
];

export function prepareConnectorConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new TypeError("Connector config must be an object");
    }
    if (Object.prototype.hasOwnProperty.call(config, "secrets")) {
        throw new TypeError("config.secrets is managed by the server");
    }

    const publicConfig = { ...config };
    const secrets = {};

    for (const field of SECRET_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(publicConfig, field)) {
            if (publicConfig[field] !== null && typeof publicConfig[field] !== "string") {
                throw new TypeError(`${field} must be a string`);
            }
            if (publicConfig[field]) secrets[field] = publicConfig[field];
            delete publicConfig[field];
        }
    }

    const encryptedSecrets = Object.fromEntries(
        Object.entries(secrets).map(([field, value]) => [
            field,
            encryptSecret(value).toString("base64"),
        ])
    );

    return {
        config: Object.keys(publicConfig).length || Object.keys(encryptedSecrets).length
            ? {
                ...publicConfig,
                ...(Object.keys(encryptedSecrets).length ? { secrets: encryptedSecrets } : {}),
            }
            : null,
        // New secrets live in config.secrets. Keep the legacy column empty on writes.
        secretsEnc: null,
    };
}

export function getConnectorConfig(connector) {
    const config = connector.config && typeof connector.config === "object"
        ? { ...connector.config }
        : {};
    const storedSecrets = config.secrets;
    delete config.secrets;

    // Read legacy plaintext-in-config secrets while existing records are migrated.
    const secrets = {};
    for (const field of SECRET_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(config, field)) {
            secrets[field] = config[field];
            delete config[field];
        }
    }

    // Backward compatibility for connectors written before secrets moved into config.
    if (connector.secretsEnc) {
        const serializedSecrets = decryptSecret(connector.secretsEnc);
        let legacySecrets;
        try {
            legacySecrets = JSON.parse(serializedSecrets);
        } catch {
            throw new Error(`Connector ${connector.id} has invalid encrypted configuration`);
        }
        if (!legacySecrets || typeof legacySecrets !== "object" || Array.isArray(legacySecrets)) {
            throw new Error(`Connector ${connector.id} has invalid encrypted configuration`);
        }
        Object.assign(secrets, legacySecrets);
    }

    if (storedSecrets !== undefined) {
        if (!storedSecrets || typeof storedSecrets !== "object" || Array.isArray(storedSecrets)) {
            throw new Error(`Connector ${connector.id} has invalid encrypted configuration`);
        }
        for (const [field, ciphertext] of Object.entries(storedSecrets)) {
            if (typeof ciphertext !== "string") {
                throw new Error(`Connector ${connector.id} has invalid encrypted configuration`);
            }
            secrets[field] = decryptSecret(Buffer.from(ciphertext, "base64"));
        }
    }

    return { ...config, ...secrets };
}

export function verifyHmacSignature({
    secret,
    signature,
    payload,
    encoding = "hex",
    prefix = "",
}) {
    if (!secret || typeof signature !== "string") return false;
    if (encoding !== "hex" && encoding !== "base64") return false;

    const value = prefix && signature.startsWith(prefix)
        ? signature.slice(prefix.length)
        : signature;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest();
    let received;
    try {
        received = Buffer.from(value, encoding);
    } catch {
        return false;
    }
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function getRawBody(req) {
    return typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body ?? {});
}

export function getNestedValue(obj, path) {
    if (!path) return undefined;
    return String(path).split(".").reduce((value, key) => value?.[key], obj);
}

export async function ingestMappedOrder({ payload, fieldMap, connectorId, workspaceId, req, createOrder }) {
    const externalId = getNestedValue(payload, fieldMap.externalId);
    const orderedAt = getNestedValue(payload, fieldMap.orderedAt);
    const currency = getNestedValue(payload, fieldMap.currency);
    const grossAmount = Number(getNestedValue(payload, fieldMap.grossAmount));
    const mappedNetAmount = getNestedValue(payload, fieldMap.netAmount);
    const netAmount = Number(mappedNetAmount ?? grossAmount);

    if (externalId === undefined || externalId === null || String(externalId) === "") {
        throw new Error("Mapped order externalId is missing");
    }
    if (!orderedAt || !Number.isFinite(Date.parse(orderedAt))) {
        throw new Error("Mapped order orderedAt is missing or invalid");
    }
    if (typeof currency !== "string" || currency.length !== 3) {
        throw new Error("Mapped order currency must be a 3-character ISO code");
    }
    if (!Number.isFinite(grossAmount) || !Number.isFinite(netAmount)) {
        throw new Error("Mapped order amounts must be valid numbers");
    }

    const fakeRes = {
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

    await createOrder({
        workspaceId,
        body: {
            externalId: String(externalId),
            orderedAt,
            currency: currency.toUpperCase(),
            grossAmount,
            netAmount,
            discountAmount: Number(getNestedValue(payload, fieldMap.discountAmount) ?? 0),
            taxAmount: Number(getNestedValue(payload, fieldMap.taxAmount) ?? 0),
            email: getNestedValue(payload, fieldMap.email) ?? null,
            phone: getNestedValue(payload, fieldMap.phone) ?? null,
            checkoutToken: getNestedValue(payload, fieldMap.checkoutToken) ?? null,
            visitorId: getNestedValue(payload, fieldMap.visitorId) ?? null,
            locationId: getNestedValue(payload, fieldMap.locationId) ?? null,
            connectorId,
        },
        ip: req.ip ?? null,
        headers: req.headers ?? {},
        apiKey: {},
    }, fakeRes);

    if (fakeRes.statusCode >= 400) {
        throw new Error(`Order ingestion failed (${fakeRes.statusCode}): ${fakeRes.body?.message ?? "unknown error"}`);
    }

    return fakeRes.body;
}
