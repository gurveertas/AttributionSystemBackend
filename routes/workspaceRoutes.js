/**
 * Workspace Routes — /api/workspace/*
 *
 * Company admin endpoints for managing workspace settings, team,
 * locations, channel mapping rules, webhooks, and audit log.
 */

import { Router } from "express";
import { protectRoute, requireRole } from "../middlewares/protectRoute.js";
import {
    getWorkspaceSettings,
    deleteWorkspace,
    updateWorkspaceSettings,
    inviteUser,
    acceptInvite,
    listTeam,
    updateTeamMember,
    listLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    listChannelMappingRules,
    createChannelMappingRule,
    updateChannelMappingRule,
    deleteChannelMappingRule,
    listWebhookEndpoints,
    createWebhookEndpoint,
    updateWebhookEndpoint,
    deleteWebhookEndpoint,
    getAuditLog,
} from "../controllers/workspaceController.js";
import {
    getDashboardOverview,
    getSummaryReport,
    getChannelsReport,
    getCampaignsReport,
    getLocationsReport,
    getTrendReport,
    getCustomersReport,
} from "../controllers/reportsController.js";
import { listCustomers, getCustomerJourney } from "../controllers/customerController.js";
import { listOrders } from "../controllers/orderController.js";
import { listBookings, listUpcomingBookings } from "../controllers/bookingController.js";

const router = Router();

router.delete("/:workspaceId", protectRoute, deleteWorkspace);


// ── Settings (company_admin only) ──────────────────────────────────────────
router.get("/settings", protectRoute, requireRole("company_admin", "platform_admin"), getWorkspaceSettings);
router.patch("/settings", protectRoute, requireRole("company_admin", "platform_admin"), updateWorkspaceSettings);

// ── Team / Invites ─────────────────────────────────────────────────────────
router.post("/invites", protectRoute, requireRole("company_admin", "platform_admin"), inviteUser);
router.post("/invites/accept", acceptInvite); // no auth (uses invite token)
router.get("/team", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listTeam);
router.patch("/team/:userId", protectRoute, requireRole("company_admin", "platform_admin"), updateTeamMember);

// ── Locations ──────────────────────────────────────────────────────────────
router.get("/locations", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listLocations);
router.post("/locations", protectRoute, requireRole("company_admin", "platform_admin"), createLocation);
router.patch("/locations/:id", protectRoute, requireRole("company_admin", "platform_admin"), updateLocation);
router.delete("/locations/:id", protectRoute, requireRole("company_admin", "platform_admin"), deleteLocation);

// ── Channel Mapping Rules ──────────────────────────────────────────────────
router.get("/channel-rules", protectRoute, requireRole("company_admin", "platform_admin"), listChannelMappingRules);
router.post("/channel-rules", protectRoute, requireRole("company_admin", "platform_admin"), createChannelMappingRule);
router.patch("/channel-rules/:id", protectRoute, requireRole("company_admin", "platform_admin"), updateChannelMappingRule);
router.delete("/channel-rules/:id", protectRoute, requireRole("company_admin", "platform_admin"), deleteChannelMappingRule);

// ── Outbound Webhooks ──────────────────────────────────────────────────────
router.get("/webhooks", protectRoute, requireRole("company_admin", "platform_admin"), listWebhookEndpoints);
router.post("/webhooks", protectRoute, requireRole("company_admin", "platform_admin"), createWebhookEndpoint);
router.patch("/webhooks/:id", protectRoute, requireRole("company_admin", "platform_admin"), updateWebhookEndpoint);
router.delete("/webhooks/:id", protectRoute, requireRole("company_admin", "platform_admin"), deleteWebhookEndpoint);

// ── Audit Log ──────────────────────────────────────────────────────────────
router.get("/audit-log", protectRoute, requireRole("company_admin", "platform_admin"), getAuditLog);

// ── Connectors (company manages their integrations) ────────────────────────
import {
    createConnector,
    listConnectors,
    updateConnector,
    deleteConnector,
    listConnectorEvents,
    replayEvent,
} from "../controllers/connectorManagementController.js";

router.get("/connectors", protectRoute, requireRole("company_admin", "platform_admin"), listConnectors);
router.post("/connectors", protectRoute, requireRole("company_admin", "platform_admin"), createConnector);
router.patch("/connectors/:id", protectRoute, requireRole("company_admin", "platform_admin"), updateConnector);
router.delete("/connectors/:id", protectRoute, requireRole("company_admin", "platform_admin"), deleteConnector);
router.get("/connectors/:id/events", protectRoute, requireRole("company_admin", "platform_admin"), listConnectorEvents);
router.post("/connectors/:id/events/:eventId/replay", protectRoute, requireRole("company_admin", "platform_admin"), replayEvent);

// ── Elysium Dashboard & Analytics (Cookie-Authenticated) ───────────────────
router.get("/dashboard", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getDashboardOverview);
router.get("/reports/dashboard", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getDashboardOverview);
router.get("/reports/summary", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getSummaryReport);
router.get("/reports/channels", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getChannelsReport);
router.get("/reports/campaigns", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getCampaignsReport);
router.get("/reports/locations", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getLocationsReport);
router.get("/reports/trend", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getTrendReport);
router.get("/reports/customers", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getCustomersReport);

// ── Customers & Journeys ───────────────────────────────────────────────────
router.get("/customers", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listCustomers);
router.get("/customers/:id/journey", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), getCustomerJourney);

// ── Transactions / Orders ──────────────────────────────────────────────────
router.get("/transactions", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listOrders);
router.get("/orders", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listOrders);

// ── Upcoming / Bookings ────────────────────────────────────────────────────
router.get("/upcoming", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listUpcomingBookings);
router.get("/bookings", protectRoute, requireRole("company_admin", "company_viewer", "platform_admin"), listBookings);

export default router;
