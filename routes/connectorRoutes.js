/**
 * Connector Webhook Routes — /api/connectors/*
 *
 * Inbound webhooks from payment/booking systems.
 * These routes do NOT use JWT auth — they verify using connector-specific
 * secrets (HMAC signatures or Stripe webhook signatures).
 */

import { Router } from "express";
import express from "express";
import {
    stripeWebhook,
    shopifyWebhook,
    zenotiWebhook,
    razorpayWebhook,
    genericWebhook,
} from "../controllers/connectorController.js";

const router = Router();

// Stripe needs the raw body for signature verification.
// Mount a raw body parser just for the Stripe route.
router.post("/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req, res, next) => {
        // Store raw body for signature verification, parse JSON body
        req.rawBody = req.body.toString("utf8");
        try { req.body = JSON.parse(req.rawBody); } catch { /* let handler deal with it */ }
        next();
    },
    stripeWebhook
);

// All others use standard JSON parsing (already applied globally)
router.post("/shopify/webhook", shopifyWebhook);
router.post("/zenoti/webhook", zenotiWebhook);
router.post("/razorpay/webhook", razorpayWebhook);
router.post("/generic/webhook", genericWebhook);

export default router;
