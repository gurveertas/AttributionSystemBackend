/**
 * Public V1 API Routes
 *
 * All routes are authenticated via API key (publishable or secret).
 * The v1Cors middleware handles CORS for browser-based calls.
 * The apiKeyAuth middleware sets req.workspaceId and req.apiKey.
 *
 * Write endpoints (SDK + connectors):
 *   POST /v1/touches
 *   POST /v1/identify
 *   POST /v1/checkout-sessions
 *   POST /v1/orders  (or /v1/conversions)
 *   PATCH /v1/orders/:id
 *   POST /v1/bookings
 *   PATCH /v1/bookings/:id
 *   POST /v1/refunds
 *
 * Read endpoints:
 *   GET /v1/orders
 *   GET /v1/orders/:id/attribution
 *   GET /v1/customers
 *   GET /v1/customers/:id/journey
 *   GET /v1/bookings
 *   GET /v1/bookings/upcoming
 *   GET /v1/reports/summary
 *   GET /v1/reports/channels
 *   GET /v1/reports/campaigns
 *   GET /v1/reports/locations
 *   GET /v1/reports/trend
 *   GET /v1/reports/customers
 */

import { Router } from "express";
import { v1Cors, apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { recordTouch, identifyVisitor, createCheckoutSession } from "../controllers/trackingController.js";
import { createOrder, updateOrder, listOrders, getOrderAttribution } from "../controllers/orderController.js";
import { createBooking, updateBooking, listBookings, listUpcomingBookings } from "../controllers/bookingController.js";
import { createRefund } from "../controllers/refundController.js";
import { listCustomers, getCustomerJourney } from "../controllers/customerController.js";
import {
    getDashboardOverview,
    getSummaryReport,
    getChannelsReport,
    getCampaignsReport,
    getLocationsReport,
    getTrendReport,
    getCustomersReport,
} from "../controllers/reportsController.js";

const router = Router();

// CORS middleware for browser-based SDK calls (answers OPTIONS preflight)
router.use(v1Cors);

// ── Write endpoints (publishable key accepted) ─────────────────────────────

router.post("/touches", apiKeyAuth(["publishable"]), recordTouch);
router.post("/identify", apiKeyAuth(["publishable"]), identifyVisitor);
router.post("/checkout-sessions", apiKeyAuth(["publishable"]), createCheckoutSession);

// ── Write endpoints (publishable or secret key) ────────────────────────────

router.post("/orders", apiKeyAuth(["publishable", "secret"]), createOrder);
router.post("/conversions", apiKeyAuth(["publishable", "secret"]), createOrder); // alias
router.patch("/orders/:id", apiKeyAuth(["publishable", "secret"]), updateOrder);

router.post("/bookings", apiKeyAuth(["publishable", "secret"]), createBooking);
router.patch("/bookings/:id", apiKeyAuth(["publishable", "secret"]), updateBooking);

router.post("/refunds", apiKeyAuth(["publishable", "secret"]), createRefund);

// ── Read endpoints (secret key preferred, publishable allowed for now) ─────

router.get("/orders", apiKeyAuth(["publishable", "secret"]), listOrders);
router.get("/orders/:id/attribution", apiKeyAuth(["publishable", "secret"]), getOrderAttribution);

router.get("/customers", apiKeyAuth(["publishable", "secret"]), listCustomers);
router.get("/customers/:id/journey", apiKeyAuth(["publishable", "secret"]), getCustomerJourney);

router.get("/bookings", apiKeyAuth(["publishable", "secret"]), listBookings);
router.get("/bookings/upcoming", apiKeyAuth(["publishable", "secret"]), listUpcomingBookings);

// ── Report endpoints ───────────────────────────────────────────────────────

router.get("/reports/dashboard", apiKeyAuth(["publishable", "secret"]), getDashboardOverview);
router.get("/reports/summary", apiKeyAuth(["publishable", "secret"]), getSummaryReport);
router.get("/reports/channels", apiKeyAuth(["publishable", "secret"]), getChannelsReport);
router.get("/reports/campaigns", apiKeyAuth(["publishable", "secret"]), getCampaignsReport);
router.get("/reports/locations", apiKeyAuth(["publishable", "secret"]), getLocationsReport);
router.get("/reports/trend", apiKeyAuth(["publishable", "secret"]), getTrendReport);
router.get("/reports/customers", apiKeyAuth(["publishable", "secret"]), getCustomersReport);

export default router;
