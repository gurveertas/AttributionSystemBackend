/**
 * Reports Controller  —  GET /v1/reports/*
 *
 * All reports accept:
 *   from*          - ISO date start (e.g. "2026-01-01")
 *   to*            - ISO date end
 *   model?         - attribution model (default: last_non_direct)
 *   locationId?    - filter to a specific location
 *   currency?      - reporting currency (default: workspace reporting currency)
 *   tz?            - IANA timezone for day boundaries (default: workspace timezone)
 *
 * Auth: API key via apiKeyAuth middleware.
 */

import { db } from "../src/prisma/db.js";

const DEFAULT_MODEL = "last_non_direct";

function parseReportParams(req) {
    const { from, to, model = DEFAULT_MODEL, locationId, tz } = req.query;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400 * 1000);
    const toDate = to ? new Date(to) : new Date();
    // Ensure toDate is end-of-day
    toDate.setUTCHours(23, 59, 59, 999);
    return { fromDate, toDate, model, locationId: locationId || null, tz: tz || "UTC" };
}

function inRange(dateStr, fromDate, toDate) {
    const d = new Date(dateStr);
    return d >= fromDate && d <= toDate;
}

function sumMinorUnits(arr, field) {
    return arr.reduce((sum, o) => sum + BigInt(o[field] || 0n), 0n).toString();
}

/**
 * GET /v1/reports/summary
 * Overview: revenue, orders, new/returning customers, bookings.
 */
export const getSummaryReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate, model, locationId } = parseReportParams(req);

        const workspace = await db.orm.public.Workspace.where({ id: workspaceId }).first();

        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid" && inRange(o.orderedAt, fromDate, toDate));
        if (locationId) orders = orders.filter(o => o.locationId === locationId);

        let refunds = await db.orm.public.Refund.where({ workspaceId }).all();
        refunds = refunds.filter(r => inRange(r.refundedAt, fromDate, toDate));

        let bookings = await db.orm.public.Booking.where({ workspaceId }).all();
        bookings = bookings.filter(b => inRange(b.createdAt, fromDate, toDate));
        if (locationId) bookings = bookings.filter(b => b.locationId === locationId);

        // Revenue metrics
        const grossRevenue = orders.reduce((s, o) => s + BigInt(o.grossMinorUnits || 0n), 0n);
        const discounts = orders.reduce((s, o) => s + BigInt(o.discountMinorUnits || 0n), 0n);
        const refundTotal = refunds.reduce((s, r) => s + BigInt(r.amountMinorUnits || 0n), 0n);
        const netRevenue = grossRevenue - discounts - refundTotal;

        const orderCount = orders.length;
        const aov = orderCount > 0 ? (netRevenue / BigInt(orderCount)).toString() : "0";

        const newCustomers = orders.filter(o => o.isNewCustomer).length;
        const returningCustomers = orders.filter(o => !o.isNewCustomer).length;

        // Attributed revenue (from credits under chosen model)
        let totalCredited = 0n;
        for (const order of orders) {
            const credits = await db.orm.public.AttributionCredit.where({ orderId: order.id, model }).all();
            const nonNull = credits.filter(c => c.touchId !== null);
            totalCredited += nonNull.reduce((s, c) => s + BigInt(c.amountMinorUnits || 0n), 0n);
        }

        const attributionCoverage = netRevenue > 0n
            ? (Number(totalCredited) / Number(netRevenue))
            : 0;

        // Booking metrics
        const scheduledBookings = bookings.filter(b => ["scheduled", "confirmed"].includes(b.status)).length;
        const cancelledBookings = bookings.filter(b => b.status === "cancelled").length;
        const bookedValue = bookings.reduce((s, b) => s + BigInt(b.bookedValueMinorUnits || 0n), 0n);

        return res.status(200).json({
            period: { from: fromDate.toISOString(), to: toDate.toISOString() },
            currency: workspace?.reportingCurrency || "USD",
            model,
            revenue: {
                grossMinorUnits: grossRevenue.toString(),
                discountsMinorUnits: discounts.toString(),
                refundsMinorUnits: refundTotal.toString(),
                netMinorUnits: netRevenue.toString(),
                averageOrderValueMinorUnits: aov,
            },
            orders: {
                total: orderCount,
                newCustomers,
                returningCustomers,
            },
            attribution: {
                attributedRevenueMinorUnits: totalCredited.toString(),
                coverageRate: Math.round(attributionCoverage * 10000) / 100, // percentage, 2 decimals
            },
            bookings: {
                total: bookings.length,
                scheduled: scheduledBookings,
                cancelled: cancelledBookings,
                bookedValueMinorUnits: bookedValue.toString(),
                cancellationRate: bookings.length > 0
                    ? Math.round((cancelledBookings / bookings.length) * 10000) / 100
                    : 0,
            },
        });
    } catch (error) {
        console.error("getSummaryReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/reports/channels
 * Revenue and orders broken down by channel.
 */
export const getChannelsReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate, model, locationId } = parseReportParams(req);

        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid" && inRange(o.orderedAt, fromDate, toDate));
        if (locationId) orders = orders.filter(o => o.locationId === locationId);

        // For each order, get credits under the chosen model
        const channelMap = {};

        for (const order of orders) {
            const credits = await db.orm.public.AttributionCredit.where({ orderId: order.id, model }).all();
            if (credits.length === 0) {
                // Unattributed
                const ch = "direct_unknown";
                if (!channelMap[ch]) channelMap[ch] = { channel: ch, orders: 0, netMinorUnits: 0n, newCustomers: 0, returningCustomers: 0 };
                channelMap[ch].orders++;
                channelMap[ch].netMinorUnits += BigInt(order.netMinorUnits || 0n);
                if (order.isNewCustomer) channelMap[ch].newCustomers++; else channelMap[ch].returningCustomers++;
                continue;
            }

            for (const credit of credits) {
                // Look up the touch to get channel
                let ch = "direct_unknown";
                if (credit.touchId) {
                    const touch = await db.orm.public.Touch.where({ id: credit.touchId }).first();
                    ch = touch?.channel || "direct";
                }

                if (!channelMap[ch]) channelMap[ch] = { channel: ch, orders: 0, netMinorUnits: 0n, newCustomers: 0, returningCustomers: 0 };
                channelMap[ch].orders++;
                channelMap[ch].netMinorUnits += BigInt(credit.amountMinorUnits || 0n);
                if (order.isNewCustomer) channelMap[ch].newCustomers++; else channelMap[ch].returningCustomers++;
            }
        }

        const data = Object.values(channelMap).map(c => ({
            ...c,
            netMinorUnits: c.netMinorUnits.toString(),
        })).sort((a, b) => Number(BigInt(b.netMinorUnits) - BigInt(a.netMinorUnits)));

        return res.status(200).json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, model, data });
    } catch (error) {
        console.error("getChannelsReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/reports/campaigns
 * Revenue broken down by campaign.
 */
export const getCampaignsReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate, model, locationId } = parseReportParams(req);

        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid" && inRange(o.orderedAt, fromDate, toDate));
        if (locationId) orders = orders.filter(o => o.locationId === locationId);

        const campaignMap = {};

        for (const order of orders) {
            const credits = await db.orm.public.AttributionCredit.where({ orderId: order.id, model }).all();
            for (const credit of credits) {
                let campaign = "(none)";
                let channel = "direct";
                if (credit.touchId) {
                    const touch = await db.orm.public.Touch.where({ id: credit.touchId }).first();
                    campaign = touch?.campaign || "(none)";
                    channel = touch?.channel || "direct";
                }
                const key = `${channel}::${campaign}`;
                if (!campaignMap[key]) campaignMap[key] = { channel, campaign, orders: 0, netMinorUnits: 0n };
                campaignMap[key].orders++;
                campaignMap[key].netMinorUnits += BigInt(credit.amountMinorUnits || 0n);
            }
        }

        const data = Object.values(campaignMap).map(c => ({
            ...c,
            netMinorUnits: c.netMinorUnits.toString(),
        })).sort((a, b) => Number(BigInt(b.netMinorUnits) - BigInt(a.netMinorUnits)));

        return res.status(200).json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, model, data });
    } catch (error) {
        console.error("getCampaignsReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/reports/locations
 * Revenue and orders per location.
 */
export const getLocationsReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate, model } = parseReportParams(req);

        const locations = await db.orm.public.Location.where({ workspaceId }).all();
        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid" && inRange(o.orderedAt, fromDate, toDate));

        const data = locations.map(loc => {
            const locOrders = orders.filter(o => o.locationId === loc.id);
            const net = locOrders.reduce((s, o) => s + BigInt(o.netMinorUnits || 0n), 0n);
            return {
                locationId: loc.id,
                locationName: loc.name,
                orders: locOrders.length,
                netMinorUnits: net.toString(),
                newCustomers: locOrders.filter(o => o.isNewCustomer).length,
                returningCustomers: locOrders.filter(o => !o.isNewCustomer).length,
            };
        }).sort((a, b) => Number(BigInt(b.netMinorUnits) - BigInt(a.netMinorUnits)));

        // Also include unassigned orders
        const unassigned = orders.filter(o => !o.locationId);
        if (unassigned.length > 0) {
            data.push({
                locationId: null,
                locationName: "(No location)",
                orders: unassigned.length,
                netMinorUnits: unassigned.reduce((s, o) => s + BigInt(o.netMinorUnits || 0n), 0n).toString(),
                newCustomers: unassigned.filter(o => o.isNewCustomer).length,
                returningCustomers: unassigned.filter(o => !o.isNewCustomer).length,
            });
        }

        return res.status(200).json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, data });
    } catch (error) {
        console.error("getLocationsReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/reports/trend
 * Daily revenue trend over the date range.
 */
export const getTrendReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate, model, locationId } = parseReportParams(req);
        const tz = req.query.tz || "UTC";

        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid" && inRange(o.orderedAt, fromDate, toDate));
        if (locationId) orders = orders.filter(o => o.locationId === locationId);

        // Group by day (ISO date string in specified timezone)
        const dayMap = {};
        for (const order of orders) {
            const d = new Date(order.orderedAt).toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
            if (!dayMap[d]) dayMap[d] = { date: d, orders: 0, netMinorUnits: 0n, newCustomers: 0 };
            dayMap[d].orders++;
            dayMap[d].netMinorUnits += BigInt(order.netMinorUnits || 0n);
            if (order.isNewCustomer) dayMap[d].newCustomers++;
        }

        const data = Object.values(dayMap).map(d => ({
            ...d,
            netMinorUnits: d.netMinorUnits.toString(),
        })).sort((a, b) => a.date.localeCompare(b.date));

        return res.status(200).json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, tz, data });
    } catch (error) {
        console.error("getTrendReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * GET /v1/reports/customers
 * New vs returning split, cohort data summary.
 */
export const getCustomersReport = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;
        const { fromDate, toDate } = parseReportParams(req);

        const customers = await db.orm.public.Customer.where({ workspaceId }).all();
        const newInPeriod = customers.filter(c => c.firstPurchaseAt && inRange(c.firstPurchaseAt, fromDate, toDate));
        const returningInPeriod = customers.filter(c =>
            c.firstPurchaseAt && new Date(c.firstPurchaseAt) < fromDate &&
            c.lastPurchaseAt && inRange(c.lastPurchaseAt, fromDate, toDate)
        );

        // Customers with 2+ orders = repeat customers
        let orders = await db.orm.public.Order.where({ workspaceId }).all();
        orders = orders.filter(o => o.status === "paid");

        const ordersByCustomer = {};
        for (const o of orders) {
            if (!o.customerId) continue;
            ordersByCustomer[o.customerId] = (ordersByCustomer[o.customerId] || 0) + 1;
        }
        const repeatCustomers = Object.values(ordersByCustomer).filter(count => count >= 2).length;
        const totalWithOrders = Object.keys(ordersByCustomer).length;
        const repeatRate = totalWithOrders > 0 ? Math.round((repeatCustomers / totalWithOrders) * 10000) / 100 : 0;

        return res.status(200).json({
            period: { from: fromDate.toISOString(), to: toDate.toISOString() },
            newCustomers: newInPeriod.length,
            returningCustomers: returningInPeriod.length,
            totalCustomers: customers.filter(c => !c.mergedIntoId).length,
            repeatRate,
        });
    } catch (error) {
        console.error("getCustomersReport error:", error.message);
        return res.status(500).json({ message: "Internal server error" });
    }
};
