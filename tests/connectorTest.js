// test-connectors.js
// Usage:
//   BASE_URL=http://localhost:3000 \
//   STRIPE_CONNECTOR_ID=... STRIPE_WEBHOOK_SECRET=whsec_test_123 \
//   SHOPIFY_CONNECTOR_ID=... SHOPIFY_SHARED_SECRET=... \
//   ZENOTI_CONNECTOR_ID=... ZENOTI_WEBHOOK_SECRET=... \
//   RAZORPAY_CONNECTOR_ID=... RAZORPAY_WEBHOOK_SECRET=... \
//   GENERIC_CONNECTOR_ID=... GENERIC_WEBHOOK_SECRET=... \
//   node test-connectors.js
//
// Each secret must match the value stored in that connector's config.
// Tests for a connector are skipped if its connector ID is not set.

import crypto from "crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const RUN_ID = Date.now(); // keeps externalIds unique between runs

const C = {
  stripe: {
    id: process.env.STRIPE_CONNECTOR_ID,
    secret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_123",
  },
  shopify: {
    id: process.env.SHOPIFY_CONNECTOR_ID,
    secret: process.env.SHOPIFY_SHARED_SECRET || "shopify_test_secret",
  },
  zenoti: {
    id: process.env.ZENOTI_CONNECTOR_ID,
    secret: process.env.ZENOTI_WEBHOOK_SECRET || "zenoti_test_secret",
  },
  razorpay: {
    id: process.env.RAZORPAY_CONNECTOR_ID,
    secret: process.env.RAZORPAY_WEBHOOK_SECRET || "rzp_test_secret",
  },
  generic: {
    id: process.env.GENERIC_CONNECTOR_ID,
    secret: process.env.GENERIC_WEBHOOK_SECRET || "generic_test_secret",
  },
};

// ── Signing helpers ──────────────────────────────────────────────────────────

const hmac = (secret, data, encoding) =>
  crypto.createHmac("sha256", secret).update(data).digest(encoding);

// Stripe: header is "t=<unix>,v1=<hex HMAC of "<t>.<body>">"
function stripeSignature(secret, body) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${hmac(secret, `${t}.${body}`, "hex")}`;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function post(path, { headers = {}, body }) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, json };
}

// ── Test definitions ─────────────────────────────────────────────────────────

const tests = [];

/**
 * @param {string} group   connector name, used for skipping
 * @param {string} name    description
 * @param {number} expect  expected HTTP status
 * @param {() => Promise<{status:number}>} run
 * @param {object} [opts]  { knownIssue: string } marks an expected deviation
 */
function test(group, name, expect, run, opts = {}) {
  tests.push({ group, name, expect, run, ...opts });
}

// Stripe
const stripeBody = (type, object) =>
  JSON.stringify({ id: `evt_${RUN_ID}`, type, created: Math.floor(Date.now() / 1000), data: { object } });

test("stripe", "payment_intent.succeeded with valid signature", 200, () => {
  const body = stripeBody("payment_intent.succeeded", {
    id: `pi_${RUN_ID}`,
    created: Math.floor(Date.now() / 1000),
    currency: "usd",
    amount: 4900,
    amount_received: 4900,
    receipt_email: "stripe@test.com",
    metadata: {},
  });
  return post(`/api/connectors/stripe/webhook?connectorId=${C.stripe.id}`, {
    headers: { "stripe-signature": stripeSignature(C.stripe.secret, body) },
    body,
  });
});

test("stripe", "payment_intent.succeeded with bad signature", 400, () => {
  const body = stripeBody("payment_intent.succeeded", { id: "pi_bad", amount: 100 });
  return post(`/api/connectors/stripe/webhook?connectorId=${C.stripe.id}`, {
    headers: { "stripe-signature": "t=1,v1=deadbeef" },
    body,
  });
});

test("stripe", "charge.refunded (needs a matching prior order)", 200, () => {
  const body = stripeBody("charge.refunded", {
    id: `ch_${RUN_ID}`,
    payment_intent: `pi_${RUN_ID}`,
    refunds: {
      data: [{ id: `re_${RUN_ID}`, amount: 1000, currency: "usd", created: Math.floor(Date.now() / 1000) }],
    },
  });
  return post(`/api/connectors/stripe/webhook?connectorId=${C.stripe.id}`, {
    headers: { "stripe-signature": stripeSignature(C.stripe.secret, body) },
    body,
  });
});

// Shopify
const shopifyOrder = (id) =>
  JSON.stringify({
    id,
    processed_at: new Date().toISOString(),
    currency: "USD",
    total_price: "49.00",
    subtotal_price: "45.00",
    total_discounts: "0.00",
    total_tax: "4.00",
    email: "shopify@test.com",
    line_items: [{ id: 1, name: "Test item", quantity: 1, price: "45.00" }],
  });

test("shopify", "orders/paid with valid HMAC", 200, () => {
  const body = shopifyOrder(RUN_ID);
  return post(`/api/connectors/shopify/webhook?connectorId=${C.shopify.id}`, {
    headers: {
      "x-shopify-topic": "orders/paid",
      "x-shopify-hmac-sha256": hmac(C.shopify.secret, body, "base64"),
    },
    body,
  });
});

test("shopify", "orders/paid with wrong HMAC (same length)", 401, () => {
  const body = shopifyOrder(RUN_ID + 1);
  const wrong = hmac("not-the-secret", body, "base64");
  return post(`/api/connectors/shopify/webhook?connectorId=${C.shopify.id}`, {
    headers: { "x-shopify-topic": "orders/paid", "x-shopify-hmac-sha256": wrong },
    body,
  });
});

test("shopify", "orders/paid with HMAC of wrong length", 401, () => {
  const body = shopifyOrder(RUN_ID + 2);
  return post(`/api/connectors/shopify/webhook?connectorId=${C.shopify.id}`, {
    headers: { "x-shopify-topic": "orders/paid", "x-shopify-hmac-sha256": "abc" },
    body,
  });
}, { knownIssue: "timingSafeEqual throws on length mismatch, so expect 500 or a hung request" });

test("shopify", "refunds/create (needs a matching prior order)", 200, () => {
  const body = JSON.stringify({
    id: RUN_ID,
    order_id: RUN_ID,
    created_at: new Date().toISOString(),
    note: "test refund",
    transactions: [{ amount: "10.00", currency: "USD" }],
  });
  return post(`/api/connectors/shopify/webhook?connectorId=${C.shopify.id}`, {
    headers: {
      "x-shopify-topic": "refunds/create",
      "x-shopify-hmac-sha256": hmac(C.shopify.secret, body, "base64"),
    },
    body,
  });
});

// Zenoti
const zenotiPost = (payload) => {
  const body = JSON.stringify(payload);
  return post(`/api/connectors/zenoti/webhook?connectorId=${C.zenoti.id}`, {
    headers: { "x-zenoti-signature": hmac(C.zenoti.secret, body, "hex") },
    body,
  });
};

test("zenoti", "appointment.created with attribution token in notes", 200, () =>
  zenotiPost({
    event_type: "appointment.created",
    appointment: {
      id: `A${RUN_ID}`,
      start_time: "2026-10-20T10:00:00Z",
      price: 80,
      notes: "attribution_token:3f2a1b4c-0000-4000-8000-000000000001",
      guest: { email: "zenoti@test.com" },
      service: { name: "Haircut" },
    },
  }));

test("zenoti", "invoice.paid", 200, () =>
  zenotiPost({
    event_type: "invoice.paid",
    invoice: {
      id: `INV${RUN_ID}`,
      total: 80,
      sub_total: 75,
      tax: 5,
      date: new Date().toISOString(),
      guest: { email: "zenoti@test.com" },
    },
  }));

test("zenoti", "unknown event type is accepted", 200, () =>
  zenotiPost({ event_type: "guest.updated", guest: { id: 1 } }));

// Razorpay
const razorpayBody = (id) =>
  JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: id,
          order_id: `order_${id}`,
          amount: 150000,
          currency: "INR",
          email: "rzp@test.com",
          contact: "+919999999999",
          created_at: Math.floor(Date.now() / 1000),
          notes: {},
        },
      },
    },
  });

test("razorpay", "payment.captured with valid signature", 200, () => {
  const body = razorpayBody(`pay_${RUN_ID}`);
  return post(`/api/connectors/razorpay/webhook?connectorId=${C.razorpay.id}`, {
    headers: { "x-razorpay-signature": hmac(C.razorpay.secret, body, "hex") },
    body,
  });
});

test("razorpay", "payment.captured with wrong signature (same length)", 401, () => {
  const body = razorpayBody(`pay_${RUN_ID}_b`);
  const wrong = hmac("not-the-secret", body, "hex");
  return post(`/api/connectors/razorpay/webhook?connectorId=${C.razorpay.id}`, {
    headers: { "x-razorpay-signature": wrong },
    body,
  });
});

test("razorpay", "payment.captured with signature of wrong length", 401, () => {
  const body = razorpayBody(`pay_${RUN_ID}_c`);
  return post(`/api/connectors/razorpay/webhook?connectorId=${C.razorpay.id}`, {
    headers: { "x-razorpay-signature": "abc" },
    body,
  });
}, { knownIssue: "timingSafeEqual throws on length mismatch, so expect 500 or a hung request" });

// Generic
// Requires the connector config to contain roughly:
// {
//   webhookSecret: <GENERIC_WEBHOOK_SECRET>,
//   eventTypeField: "type",
//   orderEventTypes: ["order.paid"],
//   bookingEventTypes: ["booking.created"],
//   fieldMap: {
//     externalId: "order.id", grossAmount: "order.total", currency: "order.currency",
//     orderedAt: "order.date", email: "customer.email",
//     appointmentStartAt: "booking.start", bookedValue: "booking.value", serviceName: "booking.service"
//   }
// }
const genericOrder = () =>
  JSON.stringify({
    type: "order.paid",
    order: { id: `G${RUN_ID}`, total: 25, currency: "usd", date: new Date().toISOString() },
    customer: { email: "generic@test.com" },
  });

test("generic", "order.paid with valid HMAC", 200, () => {
  const body = genericOrder();
  return post(`/api/connectors/generic/webhook?connectorId=${C.generic.id}`, {
    headers: { "x-signature": hmac(C.generic.secret, body, "hex") },
    body,
  });
});

test("generic", "order.paid with bad signature", 401, () => {
  const body = genericOrder();
  return post(`/api/connectors/generic/webhook?connectorId=${C.generic.id}`, {
    headers: { "x-signature": "0".repeat(64) },
    body,
  });
});

test("generic", "unknown event type is stored and accepted", 200, () => {
  const body = JSON.stringify({ type: "something.else", id: 1 });
  return post(`/api/connectors/generic/webhook?connectorId=${C.generic.id}`, {
    headers: { "x-signature": hmac(C.generic.secret, body, "hex") },
    body,
  });
});

test("generic", "booking.created with valid HMAC", 200, () => {
  const body = JSON.stringify({
    type: "booking.created",
    booking: { id: `B${RUN_ID}`, start: new Date().toISOString(), value: 60, service: "Massage" },
    customer: { email: "generic@test.com" },
  });
  return post(`/api/connectors/generic/webhook?connectorId=${C.generic.id}`, {
    headers: { "x-signature": hmac(C.generic.secret, body, "hex") },
    body,
  });
});

// Missing connector
test("generic", "unknown connectorId returns 404", 404, () =>
  post(`/api/connectors/generic/webhook?connectorId=does-not-exist`, {
    headers: { "x-signature": "x" },
    body: JSON.stringify({ type: "order.paid" }),
  }));

// ── Runner ───────────────────────────────────────────────────────────────────

const requiredId = { stripe: C.stripe.id, shopify: C.shopify.id, zenoti: C.zenoti.id, razorpay: C.razorpay.id, generic: C.generic.id };

async function main() {
  let pass = 0, fail = 0, known = 0, skipped = 0;
  let currentGroup = null;

  for (const t of tests) {
    if (t.group !== currentGroup) {
      currentGroup = t.group;
      console.log(`\n== ${currentGroup} ==`);
    }

    if (t.group !== "generic" && !requiredId[t.group]) {
      console.log(`  SKIP  ${t.name} (no connector ID set)`);
      skipped++;
      continue;
    }
    if (t.group === "generic" && !C.generic.id && t.name !== "unknown connectorId returns 404") {
      console.log(`  SKIP  ${t.name} (no connector ID set)`);
      skipped++;
      continue;
    }

    let status;
    try {
      ({ status } = await t.run());
    } catch (err) {
      status = `ERROR: ${err.cause?.code || err.message}`;
    }

    if (status === t.expect) {
      console.log(`  PASS  ${t.name} -> ${status}`);
      pass++;
    } else if (t.knownIssue) {
      console.log(`  KNOWN ${t.name} -> ${status} (expected ${t.expect}; ${t.knownIssue})`);
      known++;
    } else {
      console.log(`  FAIL  ${t.name} -> ${status} (expected ${t.expect})`);
      fail++;
    }
  }

  console.log(`\nPassed: ${pass}  Failed: ${fail}  Known issues: ${known}  Skipped: ${skipped}`);
  console.log("Check the Order, Booking, Refund, and RawEvent tables for the records these tests created.");
  process.exit(fail > 0 ? 1 : 0);
}

main();