/**
 * Connector Management Controller  —  /api/workspace/connectors/*
 *
 * Company admins create and manage their inbound connectors
 * (Stripe, Shopify, Zenoti, Razorpay, Generic).
 */

import crypto from "crypto";
import { db } from "../src/prisma/db.js";

const orm = () => db.orm.public;
const VALID_TYPES = ["zenoti", "stripe", "shopify", "razorpay", "generic", "woocommerce", "paypal", "square"];

/**
 * POST /api/workspace/connectors
 * Body: { type, name, config? }
 */
export const createConnector = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const { type, name, config = {} } = req.body ?? {};

        if (!type || !VALID_TYPES.includes(type)) {
            return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(", ")}` });
        }
        if (!name || typeof name !== "string" || name.trim().length < 1) {
            return res.status(400).json({ message: "name is required" });
        }

        const publicId = `conn_${crypto.randomBytes(12).toString("hex")}`;

        const connector = await db.transaction(async (tx) => {
            const created = await tx.orm.public.Connector.create({
                workspaceId,
                type,
                name: name.trim(),
                publicId,
                status: "pending",
                config: config || null,
            });

            await tx.orm.public.AuditLog.create({
                workspaceId,
                actorType: "user",
                actorUserId: req.user.id,
                action: "connector.created",
                targetType: "connector",
                targetId: created.id,
                metadata: { type, name: name.trim() },
                ip: req.ip ?? null,
                userAgent: req.headers["user-agent"] ?? null,
            });

            return created;
        });

        // Build the webhook URL the user should configure in their system
        const baseUrl = process.env.APP_API_URL || `https://api.example.com`;
        const webhookUrl = `${baseUrl}/api/connectors/${type}/webhook?connectorId=${connector.id}`;

        return res.status(201).json({
            id: connector.id,
            publicId: connector.publicId,
            type: connector.type,
            name: connector.name,
            status: connector.status,
            webhookUrl,
            createdAt: connector.createdAt,
        });
    } catch (error) {
        console.error("createConnector:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /api/workspace/connectors
 */
export const listConnectors = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const connectors = await orm().Connector.where({ workspaceId }).all();

        return res.status(200).json({
            data: connectors.map(c => ({
                id: c.id,
                publicId: c.publicId,
                type: c.type,
                name: c.name,
                status: c.status,
                errorCount: c.errorCount,
                lastError: c.lastError ?? null,
                lastEventAt: c.lastEventAt ?? null,
                lastErrorAt: c.lastErrorAt ?? null,
                createdAt: c.createdAt,
            })),
        });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * PATCH /api/workspace/connectors/:id
 * Body: { name?, config?, status? }
 */
export const updateConnector = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const connector = await orm().Connector.where({ id: req.params.id, workspaceId }).first();
        if (!connector) return res.status(404).json({ message: "Connector not found" });

        const allowed = ["name", "config", "status"];
        const changes = Object.fromEntries(
            Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k))
        );

        if (changes.status && !["pending", "healthy", "disabled"].includes(changes.status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        if (!Object.keys(changes).length) return res.status(400).json({ message: "Nothing to update" });

        await orm().Connector.where({ id: connector.id }).update(changes);
        return res.status(200).json({ message: "Connector updated" });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * DELETE /api/workspace/connectors/:id
 */
export const deleteConnector = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const connector = await orm().Connector.where({ id: req.params.id, workspaceId }).first();
        if (!connector) return res.status(404).json({ message: "Connector not found" });

        await db.transaction(async (tx) => {
            await tx.orm.public.Connector.where({ id: connector.id }).delete();
            await tx.orm.public.AuditLog.create({
                workspaceId,
                actorType: "user",
                actorUserId: req.user.id,
                action: "connector.deleted",
                targetType: "connector",
                targetId: connector.id,
                metadata: { type: connector.type, name: connector.name },
                ip: req.ip ?? null,
                userAgent: req.headers["user-agent"] ?? null,
            });
        });

        return res.status(204).end();
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /api/workspace/connectors/:id/events
 * Lists raw events for this connector (live feed / event log).
 */
export const listConnectorEvents = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const connector = await orm().Connector.where({ id: req.params.id, workspaceId }).first();
        if (!connector) return res.status(404).json({ message: "Connector not found" });

        let events = await orm().RawEvent.where({ connectorId: connector.id }).all();
        events.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
        const total = events.length;

        // Filter by status if provided
        if (req.query.status) events = events.filter(e => e.status === req.query.status);

        const data = events.slice((page - 1) * limit, page * limit).map(e => ({
            id: e.id,
            source: e.source,
            eventType: e.eventType,
            status: e.status,
            error: e.error,
            replayCount: e.replayCount,
            receivedAt: e.receivedAt,
            processedAt: e.processedAt,
            // Exclude full payload unless admin explicitly requests it
            hasPayload: !!e.payload,
        }));

        return res.status(200).json({
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * POST /api/workspace/connectors/:id/events/:eventId/replay
 * Re-processes a failed raw event.
 */
export const replayEvent = async (req, res) => {
    try {
        const workspaceId = req.user.workspaceId;
        const connector = await orm().Connector.where({ id: req.params.id, workspaceId }).first();
        if (!connector) return res.status(404).json({ message: "Connector not found" });

        const rawEvent = await orm().RawEvent.where({ id: req.params.eventId, connectorId: connector.id }).first();
        if (!rawEvent) return res.status(404).json({ message: "Event not found" });

        if (rawEvent.status === "processed") {
            return res.status(400).json({ message: "Event has already been processed successfully" });
        }

        // Mark as replaying
        await orm().RawEvent.where({ id: rawEvent.id }).update({
            status: "replaying",
            replayCount: (rawEvent.replayCount || 0) + 1,
        });

        // The actual replay would re-send the payload through the connector handler.
        // For now, mark it as ready for the processing pipeline.
        return res.status(200).json({
            message: "Event queued for replay",
            eventId: rawEvent.id,
            replayCount: (rawEvent.replayCount || 0) + 1,
        });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
};
