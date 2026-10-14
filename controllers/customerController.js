/**
 * Customers Controller  —  GET /v1/customers  |  GET /v1/customers/:id/journey
 *
 * Public API read endpoints for customers and their attribution journeys.
 * Auth: API key (publishable or secret) via apiKeyAuth middleware.
 */

import { db } from "../src/prisma/db.js";

/**
 * GET /v1/customers — list customers for this workspace
 */
export const listCustomers = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        let customers = await db.orm.public.Customer.where({ workspaceId }).all();

        // Filter out merged customers
        customers = customers.filter(c => !c.mergedIntoId);

        // Search by external ID if provided
        if (req.query.externalId && req.query.externalIdKey) {
            customers = customers.filter(c => {
                try {
                    const ext = c.externalIds || {};
                    return ext[req.query.externalIdKey] === req.query.externalId;
                } catch { return false; }
            });
        }

        customers.sort((a, b) => String(b.firstSeenAt).localeCompare(String(a.firstSeenAt)));

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
        const total = customers.length;

        const data = customers.slice((page - 1) * limit, page * limit).map(c => ({
            id: c.id,
            firstSeenAt: c.firstSeenAt,
            firstPurchaseAt: c.firstPurchaseAt ?? null,
            lastPurchaseAt: c.lastPurchaseAt ?? null,
            externalIds: c.externalIds ?? null,
        }));

        return res.status(200).json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error("listCustomers error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/customers/:id/journey — full attribution journey for a customer
 *
 * Returns:
 *   - all touches (timeline)
 *   - all orders with attribution credits
 *   - all bookings with attribution credits
 *   - all refunds
 */
export const getCustomerJourney = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const customer = await db.orm.public.Customer.where({ id: req.params.id, workspaceId }).first();
        if (!customer) return res.status(404).json({ message: "Customer not found" });

        // Get all visitors linked to this customer
        const visitors = await db.orm.public.Visitor.where({ workspaceId, customerId: customer.id }).all();
        const visitorIds = visitors.map(v => v.id);

        // Get touches across all visitors
        let touches = [];
        for (const vid of visitorIds) {
            const vTouches = await db.orm.public.Touch.where({ visitorId: vid }).all();
            touches.push(...vTouches);
        }
        touches.sort((a, b) => String(a.touchedAt).localeCompare(String(b.touchedAt)));

        // Get orders, bookings, refunds
        const orders = await db.orm.public.Order.where({ workspaceId, customerId: customer.id }).all();
        const bookings = await db.orm.public.Booking.where({ workspaceId, customerId: customer.id }).all();

        let refunds = [];
        for (const order of orders) {
            const r = await db.orm.public.Refund.where({ orderId: order.id }).all();
            refunds.push(...r);
        }

        // Get attribution credits grouped by model (default model or query param)
        const model = req.query.model || "last_non_direct";
        let orderCredits = [];
        let bookingCredits = [];
        for (const order of orders) {
            const credits = await db.orm.public.AttributionCredit.where({ orderId: order.id, model }).all();
            orderCredits.push(...credits.map(c => ({ ...c, orderId: order.id })));
        }
        for (const booking of bookings) {
            const credits = await db.orm.public.AttributionCredit.where({ bookingId: booking.id, model }).all();
            bookingCredits.push(...credits.map(c => ({ ...c, bookingId: booking.id })));
        }

        return res.status(200).json({
            customer: {
                id: customer.id,
                firstSeenAt: customer.firstSeenAt,
                firstPurchaseAt: customer.firstPurchaseAt ?? null,
                lastPurchaseAt: customer.lastPurchaseAt ?? null,
                externalIds: customer.externalIds ?? null,
            },
            touches: touches.map(t => ({
                id: t.id,
                channel: t.channel,
                source: t.source,
                medium: t.medium,
                campaign: t.campaign,
                referrer: t.referrer,
                landingPage: t.landingPage,
                gclid: t.gclid,
                fbclid: t.fbclid,
                touchedAt: t.touchedAt,
            })),
            orders: orders.map(o => ({
                id: o.id,
                externalId: o.externalId,
                status: o.status,
                currency: o.currency,
                netMinorUnits: o.netMinorUnits?.toString(),
                matchMethod: o.matchMethod,
                isNewCustomer: o.isNewCustomer,
                orderedAt: o.orderedAt,
                credits: orderCredits.filter(c => c.orderId === o.id).map(c => ({
                    touchId: c.touchId,
                    share: c.share,
                    amountMinorUnits: c.amountMinorUnits?.toString(),
                })),
            })),
            bookings: bookings.map(b => ({
                id: b.id,
                externalId: b.externalId,
                status: b.status,
                currency: b.currency,
                bookedValueMinorUnits: b.bookedValueMinorUnits?.toString(),
                serviceName: b.serviceName,
                matchMethod: b.matchMethod,
                appointmentStartAt: b.appointmentStartAt,
                credits: bookingCredits.filter(c => c.bookingId === b.id).map(c => ({
                    touchId: c.touchId,
                    share: c.share,
                    amountMinorUnits: c.amountMinorUnits?.toString(),
                })),
            })),
            refunds: refunds.map(r => ({
                id: r.id,
                orderId: r.orderId,
                amountMinorUnits: r.amountMinorUnits?.toString(),
                currency: r.currency,
                reason: r.reason,
                refundedAt: r.refundedAt,
            })),
            touchCount: touches.length,
            attributionModel: model,
        });
    } catch (error) {
        console.error("getCustomerJourney error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};
