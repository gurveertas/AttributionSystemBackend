# Attribution Platform — Client Service Delivery & Rollout Plan

## 1. Executive Overview

This document defines how we deliver our multi-touch attribution platform to clients — from self-serve e-commerce brands to high-ticket service companies (clinics, salons, spas, B2B services). 

Our system solves the modern tracking crisis caused by Apple iOS 14.5+ ATT, Safari ITP cookie expiration, cross-device drop-offs, and fragmented payment gateways. We provide first-party, server-side verified attribution across **6 mathematical models**:
1. **First Touch** (Top of funnel / discovery)
2. **Last Touch** (Immediate conversion driver)
3. **Last Non-Direct** (Standard e-commerce baseline)
4. **Linear** (Even multi-touch contribution)
5. **Time Decay** (7-day half-life favoring recent interactions)
6. **Position-Based (U-Shaped)** (40% first, 40% last, 20% middle touches)

---

## 2. Client Implementation Architecture

```mermaid
flowchart TD
    subgraph Client Assets
        Website[Client Website / Storefront]
        Cart[Checkout / Booking Page]
    end

    subgraph Tracking SDK
        SDK[Attribution SDK Script]
        Touch[Touch Tracking: UTMs, Referrers, Click IDs]
        ID[Identity Resolution: Email/Phone Hashing]
        Session[Checkout Session Token Freeze]
    end

    subgraph Ingestion & Attribution Backend
        API[/v1/touches & /v1/identify]
        Connectors[Payment & Booking Connectors: Stripe, Shopify, Zenoti, Razorpay]
        Engine[Attribution Engine: 6 Models Calculated Transactionally]
        DB[(PostgreSQL 15+ Database)]
        OutboundHooks[Outbound Webhooks: HMAC Signed]
    end

    subgraph Client Experience
        Dashboard[Frontend Analytics Dashboard]
        CRM[Client CRM / Data Warehouse]
    end

    Website -->|Loads snippet| SDK
    SDK -->|Captures pageview & ad click IDs| Touch
    Touch -->|POST /v1/touches| API
    Cart -->|Identifies customer| ID
    ID -->|POST /v1/identify| API
    Cart -->|Freezes touch state| Session
    Session -->|POST /v1/checkout-sessions| API

    API --> Engine
    Connectors -->|Inbound Webhooks| Engine
    Engine --> DB
    DB --> Dashboard
    Engine -->|order.created, booking.created| OutboundHooks
    OutboundHooks --> CRM
```

---

## 3. Step-by-Step Client Onboarding Journey

### Phase 1: Workspace & Verification (Day 1)
1. **Client Registration:**
   - Client creates an account via `/api/auth/company/register`.
   - Workspace is provisioned with country ISO, reporting currency (USD, EUR, INR, etc.), and timezone.
   - Email verification is dispatched automatically.
2. **Domain Ownership Verification:**
   - Client adds their website domain in the dashboard.
   - Verified via **DNS TXT record** (`attribution-verification=...`) or **HTML `<meta>` tag**.
   - Live publishable API keys remain restricted until domain verification passes, ensuring no unauthorized site can send false tracking data.

### Phase 2: Client Website Integration (Day 2 - 3)
1. **JavaScript SDK Snippet Placement:**
   - Clients place a lightweight script (under 12 KB, async/non-blocking) in their `<head>` or via Google Tag Manager:
   ```html
   <!-- Attribution Platform SDK -->
   <script
     src="https://cdn.yourapp.com/attribution-sdk.js"
     data-api-key="pk_live_your_publishable_key"
     async>
   </script>
   ```
2. **Automatic Data Collected by Snippet:**
   - Ad Click IDs: `gclid` (Google Ads), `fbclid` (Meta), `ttclid` (TikTok), `msclkid` (Microsoft Bing).
   - Campaign UTM tags: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`.
   - First-party cookies: `fbc` / `fbp` (Meta Pixel bridge), `_ga` (Google Analytics client ID).
   - First-party anonymous visitor device identifier stored in local storage and cookies.
3. **Identity Resolution Tagging:**
   - When a user logs in, enters an email in a newsletter popup, or enters shipping details at checkout, the site invokes:
   ```javascript
   window.attribution.identify({
     email: "customer@example.com",
     phone: "+15551234567"
   });
   ```
   - Identifiers are cryptographically hashed using SHA-256 before storage to ensure complete GDPR/CCPA privacy compliance.

### Phase 3: Conversions & Payment Connectors (Day 3 - 4)
We support two ingestion methods depending on the client's tech stack:

#### Option A: Native No-Code Connectors (Recommended)
- **Shopify:** Install our app or configure a webhook pointing to `/api/connectors/shopify/webhook`.
- **Stripe:** Paste webhook secret in dashboard; webhook listens to `charge.succeeded` and `checkout.session.completed`.
- **Zenoti:** Configured for salon/spa service bookings and appointment status sync.
- **Razorpay:** Inbound webhook for Indian e-commerce merchants.

#### Option B: Server-Side REST API (Custom Carts / Mobile Apps)
- Client server calls `POST /v1/orders` or `POST /v1/bookings` using their Secret API Key (`sk_live_...`).
- Passes `checkoutToken` from the browser or fallback email/phone.

---

## 4. Service Packages & Monetization Tiers

| Tier | Target Client | Key Features | Support Level |
|---|---|---|---|
| **Starter** | Small e-commerce stores ($10k - $50k/mo revenue) | • Up to 50,000 monthly touches<br>• 1 verified domain<br>• Core 3 attribution models<br>• Standard Shopify/Stripe connectors | Self-serve + Email support |
| **Growth** | Scaling DTC brands & multi-location clinics ($50k - $250k/mo) | • Up to 250,000 monthly touches<br>• Up to 5 physical locations<br>• All 6 attribution models<br>• Outbound webhooks to CRM<br>• Custom channel mapping rules | Priority chat + 24h SLA |
| **Enterprise / Agency** | High-volume merchants & multi-brand aggregators ($250k+/mo) | • Unlimited touches (custom rate limits)<br>• Unlimited domains & locations<br>• Custom API connectors & raw event replay feed<br>• White-glove GTM tagging setup<br>• Bi-weekly media-spend optimization review | Dedicated Attribution Engineer + Slack channel |

---

## 5. Ongoing Client Value & Reporting Cadence

To retain clients long-term, attribution data must drive actionable ad spend reallocation:

### 1. Weekly Executive Snapshot
- **True Blended ROAS:** Compare ad platform reported ROAS vs Server-Verified Attributed ROAS. Clients often discover that Google Ads and Meta Ads are both claiming 100% credit for the exact same order.
- **Model Comparison:** Switch between First Touch (identifying which top-of-funnel campaigns bring new users) and Last Non-Direct (which campaigns actually close the sale).

### 2. Multi-Location Performance
- For multi-location businesses (e.g. Zenoti salon chains, dental practices), compare attribution across locations:
  - Which branch generates the highest percentage of online bookings from paid search vs organic local maps.

### 3. Customer Journey Forensics
- View the exact customer timeline:
  - Day 1: Clicked TikTok Ad (`ttclid`) → Looked at product
  - Day 3: Clicked Google Search Ad (`gclid`) → Signed up for newsletter
  - Day 7: Clicked Klaviyo Promo Email (`utm_source=email`) → Completed $240 purchase
  - Direct insight: TikTok drove the user, but Google and Email assisted.

---

## 6. Privacy, Security & Technical Compliance

1. **Zero Raw PII Storage:** Customer emails and phone numbers are hashed with SHA-256 before touching the database.
2. **Consent Modes:** Configurable per workspace:
   - `off`: Standard tracking.
   - `opt_in`: Touches recorded only after user explicitly grants consent in cookie banner.
   - `opt_out`: Tracking active by default, halted if user opts out.
3. **Data Retention Management:** Configurable raw retention window (13 to 24 months) with automated purging of stale device fingerprints.
4. **Backend Resilience:**
   - Sliding-window in-memory rate limiting prevents API key abuse or DDoS attempts.
   - Database-level pagination (`limit`, `offset`, `aggregate(count)`) prevents backend memory exhaustion.
   - Outbound webhooks employ exponential backoff retry and circuit-breaking auto-disable.
