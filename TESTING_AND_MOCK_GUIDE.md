# Elysium Attribution Platform — Testing & Mocking Guide

This guide explains how to test and mock **every functionality** of the Attribution System, from visitor tracking to multi-model attribution, identity resolution, webhooks, and the live Elysium executive dashboard.

---

## 🚀 Two Ways to Test

You have two complete testing environments:

1. **Interactive Web Mock Studio (Browser GUI)** — Beautiful, visual control panel served directly by the backend at:
   - **`http://localhost:3000`** or **`http://localhost:3000/simulator.html`**
2. **Automated End-to-End CLI Simulation Runner** — High-speed 13-step verification script:
   - Run: `node scripts/simulateAll.js`

---

## 1. Interactive Web Mock Studio (`http://localhost:3000`)

Simply open your browser to **`http://localhost:3000`** while the backend is running.

### Key Capabilities in the Web Studio:

| Tab / Module | What It Does & How to Test |
|---|---|
| **⚡ 1-Click Simulation** | Click the big blue **"Run Complete 13-Step Simulation"** button. It automatically creates a fresh workspace, registers a storefront, issues publishable & secret keys, fires multi-touch ad clicks, identifies the customer, freezes checkout session, ingests an order, processes a refund, and renders the live dashboard! |
| **🎯 Interactive Event Mocking** | • **Ad Touch Generator**: Click Google Ads, Meta Ads, TikTok Ads, Klaviyo Email, or Direct visits to fire `/v1/touches` with synthetic `gclid`, `fbclid`, and UTM parameters.<br>• **Live Journey Timeline**: Displays all touches recorded for the active visitor.<br>• **Identity Resolution Form**: Enter an email and phone, click **"Resolve & Link Customer"** to see SHA-256 PII hashing in real-time.<br>• **Checkout & Conversion**: Freeze checkout sessions, ingest orders, book Zenoti appointments, and issue refunds with one click. |
| **⚖️ 6-Model Attribution Inspector** | View side-by-side mathematical distribution bars for the current order across **First Touch**, **Last Touch**, **Last Non-Direct**, **Linear**, **Time Decay**, and **Position-Based (U-Shaped 40/20/40)** with exact dollar credit shares. |
| **📊 Live Elysium Executive Dashboard** | Renders the exact UI matching the frontend layout:<br>• Primary Gross Revenue banner with Excl. Tax, Tax, and Invoice counts.<br>• 4 Primary KPIs: New Customers, Returning Customers, Retention Rate, Tracked Visits.<br>• 4 Revenue Cards: Ad-Attributed, Direct/Organic, Refunded, and AOV with % change.<br>• Segmented horizontal Revenue by Source progress bar.<br>• Revenue by Platform table with colored badges. |
| **🔌 Connectors & Webhooks Mock** | Fire mock inbound Shopify `orders/create` or Stripe `checkout.session.completed` webhooks. |
| **🖥️ Live Network & Event Inspector** | Real-time console displaying every API request, URL, status code, and response payload. |

---

## 2. Automated End-to-End CLI Simulation Runner

In your terminal, run:

```bash
node scripts/simulateAll.js
```

### The 13 Steps Executed:

1. **Register Company Workspace & Admin Account** (`POST /api/auth/company/register`)
2. **Authenticate Admin User & Check Session** (`POST /api/auth/user/login`)
3. **Add Storefront Site & Instant Verification** (`POST /api/sites`, `POST /api/sites/:id/verify`)
4. **Issue Publishable & Secret API Keys** (`POST /api/api-keys`)
5. **Simulate Multi-Touch Customer Journey**:
   - Day -5: Google Paid Search (`gclid=Cj0K_...`, campaign: `Summer_Sale_Prospecting`)
   - Day -2: Meta Instagram Retargeting (`fbclid=IwAR_...`, campaign: `Cart_Abandoners_Retargeting`)
   - Day 0: Klaviyo Promo Email (`campaign=VIP_10_Percent_Off`)
6. **Identity Resolution & SHA-256 Hashing** (`POST /v1/identify`)
7. **Freeze Active Journey into Checkout Session** (`POST /v1/checkout-sessions`)
8. **Ingest Completed Order ($150.00)** (`POST /v1/orders`)
9. **Multi-Touch Attribution Engine Execution**:
   - Calculates attribution credit shares across all 6 models:
     - `first_touch`: 100% to first discovery
     - `last_touch`: 100% to converting touch
     - `last_non_direct`: 100% to marketing touch
     - `linear`: 33.3% split equally
     - `time_decay`: 25% / 34% / 41% (7-day half-life)
     - `position_based`: 40% first / 20% middle / 40% last
10. **Simulate Zenoti Inbound Appointment Booking** (`POST /v1/bookings`)
11. **Process Partial Refund ($35.00) & Net Revenue Adjustment** (`POST /v1/refunds`)
12. **Query Live Elysium Executive Dashboard API** (`GET /api/workspace/dashboard` & `GET /v1/reports/dashboard`)
13. **Verify Sliding Window Rate Limiter & Headers** (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)

---

## 3. Manual cURL Testing Quick Reference

### Track an Ad Click:
```bash
curl -X POST http://localhost:3000/v1/touches \
  -H "Authorization: Bearer <YOUR_PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "visitorId": "vid_manual_test_01",
    "channel": "paid_search",
    "source": "google",
    "medium": "cpc",
    "campaign": "Brand_Search",
    "gclid": "Cj0K_manual_test_123",
    "landingPage": "https://store.example.com/products/glow-serum"
  }'
```

### Identify Customer:
```bash
curl -X POST http://localhost:3000/v1/identify \
  -H "Authorization: Bearer <YOUR_PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "visitorId": "vid_manual_test_01",
    "email": "customer@example.com",
    "phone": "+12025550188"
  }'
```

### Ingest Order:
```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Authorization: Bearer <YOUR_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "ord_manual_001",
    "grossAmount": 120.00,
    "netAmount": 108.00,
    "discountAmount": 12.00,
    "taxAmount": 9.50,
    "currency": "USD",
    "visitorId": "vid_manual_test_01",
    "email": "customer@example.com"
  }'
```

### Inspect 6 Attribution Models for Order:
```bash
curl http://localhost:3000/v1/orders/<ORDER_ID>/attribution \
  -H "Authorization: Bearer <YOUR_SECRET_KEY>"
```

### Query Live Dashboard:
```bash
curl http://localhost:3000/v1/reports/dashboard \
  -H "Authorization: Bearer <YOUR_PUBLISHABLE_KEY>"
```
