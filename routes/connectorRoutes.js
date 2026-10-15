/**
 * Connector Webhook Routes — /api/connectors/*
 *
 * Inbound webhooks from payment/booking systems.
 * These routes do NOT use JWT auth — they verify using connector-specific
 * secrets (HMAC signatures or Stripe webhook signatures).
 */

import { Router } from "express";
import {
    stripeWebhook,
    shopifyWebhook,
    zenotiWebhook,
    razorpayWebhook,
    paypalWebhook,
    genericWebhook,
} from "../controllers/connectorController.js";

const router = Router();

router.post("/stripe/webhook", stripeWebhook);
router.post("/shopify/webhook", shopifyWebhook);
router.post("/zenoti/webhook", zenotiWebhook);
router.post("/razorpay/webhook", razorpayWebhook);
router.post("/paypal/webhook", paypalWebhook);
router.post("/generic/webhook", genericWebhook);
router.post("/woocommerce/webhook", genericWebhook);
router.post("/square/webhook", genericWebhook);

export default router;
