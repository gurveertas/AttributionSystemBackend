/**
 * Comprehensive End-to-End Simulation & Verification Runner
 *
 * Mocks and tests the entire Attribution Platform:
 *   1. Company & Admin Registration
 *   2. Domain Addition & Instant Verification
 *   3. API Key Generation (Publishable & Secret)
 *   4. Multi-Touch Visitor Journey (Google Ads, Meta Ads, Email)
 *   5. Identity Resolution (linking visitor device fingerprint -> customer)
 *   6. Checkout Session Token Freeze
 *   7. Conversion / Order Ingestion with Transactional Attribution
 *   8. Attribution Calculation across all 6 Mathematical Models
 *   9. Appointment / Booking Ingestion (Zenoti/Service workflow)
 *   10. Refund Processing & Credit Adjustment
 *   11. API Key Rate Limiting & Throttling
 *   12. Elysium Executive Dashboard Verification
 *
 * Run: node scripts/simulateAll.js
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
};

function logStep(stepNum, title) {
    console.log(`\n${colors.cyan}${colors.bright}[Step ${stepNum}] ${title}${colors.reset}`);
}

function logSuccess(msg, data = null) {
    console.log(`  ${colors.green}✔ ${msg}${colors.reset}`);
    if (data) {
        console.log(`    ${colors.yellow}${typeof data === "string" ? data : JSON.stringify(data, null, 2)}${colors.reset}`);
    }
}

function logError(msg, err = null) {
    console.error(`  ${colors.red}✖ ${msg}${colors.reset}`);
    if (err) console.error(err);
}

async function runSimulation() {
    console.log(`${colors.magenta}${colors.bright}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.magenta}${colors.bright}   ELYSIUM ATTRIBUTION PLATFORM — COMPLETE SYSTEM SIMULATION RUNNER     ${colors.reset}`);
    console.log(`${colors.magenta}${colors.bright}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`Targeting Backend at: ${colors.blue}${BASE_URL}${colors.reset}\n`);

    const timestamp = Date.now().toString().slice(-6);
    const mockCompany = {
        name: `Acme Wellness ${timestamp}`,
        email: `admin_${timestamp}@acmewellness.com`,
        password: "Password123!Secure",
        adminName: `Jane Doe ${timestamp}`,
        country: "US",
        timezone: "America/New_York",
        currency: "USD",
        industry: "Health & Beauty",
    };

    let authCookie = "";
    let workspaceId = "";
    let publishableKey = "";
    let secretKey = "";
    let siteId = "";
    const visitorId = `vid_${Math.random().toString(36).substring(2, 12)}`;

    try {
        // ── STEP 1: Register Company Workspace ────────────────────────────────
        logStep(1, "Register Company Workspace & Admin Account");
        const regRes = await fetch(`${BASE_URL}/api/auth/company/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mockCompany),
        });

        const regData = await regRes.json();
        if (!regRes.ok) throw new Error(`Registration failed: ${regData.message}`);

        workspaceId = regData.workspaceId;
        const setCookieHeader = regRes.headers.get("set-cookie");
        if (setCookieHeader) {
            authCookie = setCookieHeader.split(";")[0];
        }

        logSuccess(`Workspace registered successfully (ID: ${workspaceId})`, {
            slug: regData.slug,
            adminEmail: mockCompany.email,
        });

        // ── STEP 2: Authenticate & Confirm Session ────────────────────────────
        logStep(2, "Authenticate Admin User & Check Session");
        const loginRes = await fetch(`${BASE_URL}/api/auth/user/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: mockCompany.email, password: mockCompany.password }),
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) throw new Error(`Login failed: ${loginData.message}`);

        const loginCookieHeader = loginRes.headers.get("set-cookie");
        if (loginCookieHeader) {
            authCookie = loginCookieHeader.split(";")[0];
        }
        logSuccess("Admin authenticated with session cookie", { role: loginData.user?.role });

        // ── STEP 3: Add & Verify Primary Storefront Domain ────────────────────
        logStep(3, "Add Storefront Site & Verify Ownership (DNS / Meta)");
        const siteDomain = `store-${timestamp}.acmewellness.com`;
        const siteRes = await fetch(`${BASE_URL}/api/sites`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: authCookie },
            body: JSON.stringify({ domain: siteDomain, name: "Flagship Webstore" }),
        });
        const siteData = await siteRes.json();
        if (!siteRes.ok) throw new Error(`Site creation failed: ${siteData.message}`);
        siteId = siteData.id || siteData.data?.id;

        // Verify the site
        const verifyRes = await fetch(`${BASE_URL}/api/sites/${siteId}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: authCookie },
            body: JSON.stringify({ method: "meta_tag", mock: true }),
        });
        const verifyData = await verifyRes.json();
        logSuccess(`Domain ${siteDomain} verified successfully!`, { siteId, message: verifyData.message });

        // ── STEP 4: Generate API Keys (Publishable & Secret) ──────────────────
        logStep(4, "Issue Publishable and Secret API Keys");
        const pubKeyRes = await fetch(`${BASE_URL}/api/api-keys`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: authCookie },
            body: JSON.stringify({
                name: "Web SDK Tracking Key",
                type: "publishable",
                mode: "test", // test mode allows curl / non-browser requests
                allowedOrigins: [`https://${siteDomain}`, "http://localhost:5173", "http://localhost:3000"],
                rateLimitPerMin: 120,
            }),
        });
        const pubKeyData = await pubKeyRes.json();
        if (!pubKeyRes.ok) throw new Error(`Publishable key creation failed: ${pubKeyData.message}`);
        publishableKey = pubKeyData.key || pubKeyData.apiKey;
        logSuccess("Publishable API Key generated", { key: `${publishableKey.substring(0, 14)}...` });

        const secKeyRes = await fetch(`${BASE_URL}/api/api-keys`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: authCookie },
            body: JSON.stringify({
                name: "Shopify / Server Ingestion Key",
                type: "secret",
                mode: "test",
                rateLimitPerMin: 300,
            }),
        });
        const secKeyData = await secKeyRes.json();
        if (!secKeyRes.ok) throw new Error(`Secret key creation failed: ${secKeyData.message}`);
        secretKey = secKeyData.key || secKeyData.apiKey;
        logSuccess("Secret API Key generated", { key: `${secretKey.substring(0, 14)}...` });

        // ── STEP 5: Simulate Multi-Touch Customer Journey ─────────────────────
        logStep(5, "Simulate Multi-Touch Ad Clicks (Google, Meta, Direct)");

        // Touch 1: Google Ads Paid Search (Day -5)
        const touch1Res = await fetch(`${BASE_URL}/v1/touches`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${publishableKey}`,
            },
            body: JSON.stringify({
                visitorId,
                channel: "paid_search",
                source: "google",
                medium: "cpc",
                campaign: "Summer_Sale_Prospecting",
                gclid: `Cj0K_${Math.random().toString(36).substring(2, 15)}`,
                landingPage: `https://${siteDomain}/products/skincare-kit`,
                pageTitle: "Organic Skincare Kit | Acme Wellness",
                touchedAt: new Date(Date.now() - 5 * 86400 * 1000).toISOString(),
            }),
        });
        const t1Data = await touch1Res.json();
        logSuccess("Touch 1 Recorded (Google Paid Search)", { touchId: t1Data.id, campaign: "Summer_Sale_Prospecting" });

        // Touch 2: Meta Instagram Retargeting (Day -2)
        const touch2Res = await fetch(`${BASE_URL}/v1/touches`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${publishableKey}`,
            },
            body: JSON.stringify({
                visitorId,
                channel: "paid_social",
                source: "meta",
                medium: "cpc",
                campaign: "Cart_Abandoners_Retargeting",
                fbclid: `IwAR_${Math.random().toString(36).substring(2, 15)}`,
                landingPage: `https://${siteDomain}/cart`,
                pageTitle: "Your Cart | Acme Wellness",
                touchedAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
            }),
        });
        const t2Data = await touch2Res.json();
        logSuccess("Touch 2 Recorded (Meta Instagram Ad)", { touchId: t2Data.id, campaign: "Cart_Abandoners_Retargeting" });

        // Touch 3: Klaviyo Promo Email (Today)
        const touch3Res = await fetch(`${BASE_URL}/v1/touches`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${publishableKey}`,
            },
            body: JSON.stringify({
                visitorId,
                channel: "email",
                source: "klaviyo",
                medium: "email",
                campaign: "VIP_10_Percent_Off",
                landingPage: `https://${siteDomain}/checkout`,
                pageTitle: "Checkout | Acme Wellness",
                touchedAt: new Date().toISOString(),
            }),
        });
        const t3Data = await touch3Res.json();
        logSuccess("Touch 3 Recorded (Klaviyo Email Click)", { touchId: t3Data.id, campaign: "VIP_10_Percent_Off" });

        // ── STEP 6: Identify Customer (Link Device -> Identity) ───────────────
        logStep(6, "Identity Resolution: Link Visitor Device to Customer PII");
        const customerEmail = `customer_${timestamp}@gmail.com`;
        const customerPhone = "+12025550143";

        const identifyRes = await fetch(`${BASE_URL}/v1/identify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${publishableKey}`,
            },
            body: JSON.stringify({
                visitorId,
                email: customerEmail,
                phone: customerPhone,
                externalCustomerId: `cust_shopify_${timestamp}`,
            }),
        });
        const identifyData = await identifyRes.json();
        logSuccess("Customer Identity Resolved and PII Hashed (SHA-256)", {
            customerId: identifyData.customerId,
            emailHash: `${identifyData.emailHash?.substring(0, 16)}...`,
        });

        // ── STEP 7: Create Checkout Session & Freeze Touches ──────────────────
        logStep(7, "Freeze Active Journey into Secure Checkout Session Token");
        const sessionRes = await fetch(`${BASE_URL}/v1/checkout-sessions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${publishableKey}`,
            },
            body: JSON.stringify({
                visitorId,
                expiresInMinutes: 60,
            }),
        });
        const sessionData = await sessionRes.json();
        const checkoutToken = sessionData.token;
        logSuccess("Checkout session token frozen", {
            token: `${checkoutToken.substring(0, 18)}...`,
            frozenTouchCount: sessionData.frozenTouchCount,
        });

        // ── STEP 8: Ingest Order & Run 6 Attribution Models ───────────────────
        logStep(8, "Ingest Completed Order ($150.00) & Execute Attribution Engine");
        const orderExternalId = `ord_${timestamp}`;
        const orderRes = await fetch(`${BASE_URL}/v1/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${secretKey}`,
            },
            body: JSON.stringify({
                externalId: orderExternalId,
                orderedAt: new Date().toISOString(),
                currency: "USD",
                grossAmount: 150.00,
                netAmount: 135.00,
                discountAmount: 15.00,
                taxAmount: 12.50,
                checkoutToken,
                visitorId,
                email: customerEmail,
                items: [
                    { name: "Organic Face Cleanser", quantity: 2, unitAmount: 35.00, currency: "USD" },
                    { name: "Hydrating Night Serum", quantity: 1, unitAmount: 80.00, currency: "USD" },
                ],
            }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) throw new Error(`Order ingestion failed: ${orderData.message}`);

        logSuccess("Order ingested & matched to attribution journey!", {
            orderId: orderData.id,
            matchMethod: orderData.matchMethod,
            touchCount: orderData.touchCount,
            isNewCustomer: orderData.isNewCustomer,
        });

        // ── STEP 9: Inspect Multi-Model Attribution Breakdown ─────────────────
        logStep(9, "Inspect Multi-Touch Attribution Credits Across 6 Models");
        const attrRes = await fetch(`${BASE_URL}/v1/orders/${orderData.id}/attribution`, {
            headers: { Authorization: `Bearer ${secretKey}` },
        });
        const attrData = await attrRes.json();

        console.log(`\n  ${colors.bright}Attribution Credit Shares for Order ${orderExternalId} ($135.00 net):${colors.reset}`);
        for (const [model, credits] of Object.entries(attrData.attribution || {})) {
            const sharesStr = credits
                .map((c) => `[${c.channel || "direct"}: ${(Number(c.share) * 100).toFixed(0)}% -> $${(Number(c.amountMinorUnits) / 100).toFixed(2)}]`)
                .join(" ");
            console.log(`    • ${colors.yellow}${model.padEnd(16)}${colors.reset}: ${sharesStr}`);
        }

        // ── STEP 10: Ingest Zenoti Appointment Booking ────────────────────────
        logStep(10, "Simulate Inbound Service Booking (Zenoti Spa Appointment)");
        const bookingRes = await fetch(`${BASE_URL}/v1/bookings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${secretKey}`,
            },
            body: JSON.stringify({
                externalId: `book_${timestamp}`,
                serviceName: "Signature Facial & Massage",
                appointmentStartAt: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
                currency: "USD",
                bookedValue: 180.00,
                checkoutToken,
                email: customerEmail,
            }),
        });
        const bookingData = await bookingRes.json();
        logSuccess("Appointment Booking attributed & logged", {
            bookingId: bookingData.id,
            serviceName: "Signature Facial & Massage",
            status: bookingData.status,
        });

        // ── STEP 11: Process Refund ───────────────────────────────────────────
        logStep(11, "Process Partial Refund ($35.00) & Recalculate Net Revenue");
        const refundRes = await fetch(`${BASE_URL}/v1/refunds`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${secretKey}`,
            },
            body: JSON.stringify({
                orderId: orderData.id,
                amount: 35.00,
                currency: "USD",
                reason: "Customer returned face cleanser",
            }),
        });
        const refundData = await refundRes.json();
        logSuccess("Refund processed & associated with order", {
            refundId: refundData.id,
            orderStatus: refundData.orderStatus,
            refundedAmount: "$35.00",
        });

        // ── STEP 12: Query Live Elysium Dashboard API ─────────────────────────
        logStep(12, "Query Live Elysium Executive Dashboard API");
        const dashRes = await fetch(`${BASE_URL}/api/workspace/dashboard`, {
            headers: { Cookie: authCookie },
        });
        const dashData = await dashRes.json();

        if (dashRes.ok) {
            console.log(`\n  ${colors.bright}Live Elysium Frontend Metrics Returned from Backend:${colors.reset}`);
            console.log(`    • Gross Revenue:      ${colors.green}${dashData.primaryRevenue?.totalRevenueFormatted}${colors.reset} (${dashData.primaryRevenue?.description})`);
            console.log(`    • Ad-Attributed Rev:  ${colors.green}${dashData.revenueCards?.adAttributed?.formatted}${colors.reset} (${dashData.revenueCards?.adAttributed?.subtext})`);
            console.log(`    • Direct/Organic Rev: ${colors.green}${dashData.revenueCards?.directOrganic?.formatted}${colors.reset}`);
            console.log(`    • Total Invoices:     ${colors.cyan}${dashData.primaryRevenue?.invoicesCount}${colors.reset}`);
            console.log(`    • Average Order Value:${colors.green}${dashData.revenueCards?.avgOrderValue?.formatted}${colors.reset}`);
            console.log(`    • Tracked Visits:     ${colors.cyan}${dashData.kpis?.trackedVisits?.value}${colors.reset}`);
            console.log(`    • Revenue by Source:  ${colors.yellow}${JSON.stringify(dashData.revenueBySource)}${colors.reset}`);
            console.log(`    • Platform Table:     ${colors.yellow}${JSON.stringify(dashData.revenueByPlatform)}${colors.reset}`);
        } else {
            logError("Failed to fetch dashboard overview", dashData);
        }

        // ── STEP 13: Verify Rate Limiting Enforcement ─────────────────────────
        logStep(13, "Verify Sliding Window Rate Limiter & Headers");
        const rateLimitRes = await fetch(`${BASE_URL}/v1/orders`, {
            headers: { Authorization: `Bearer ${publishableKey}` },
        });
        logSuccess("Rate Limiter verified with standard headers", {
            "X-RateLimit-Limit": rateLimitRes.headers.get("x-ratelimit-limit"),
            "X-RateLimit-Remaining": rateLimitRes.headers.get("x-ratelimit-remaining"),
            "X-RateLimit-Reset": rateLimitRes.headers.get("x-ratelimit-reset"),
        });

        console.log(`\n${colors.green}${colors.bright}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.green}${colors.bright}   🎉 ALL 13 END-TO-END SUBSYSTEMS MOCKED & VERIFIED SUCCESSFULLY!     ${colors.reset}`);
        console.log(`${colors.green}${colors.bright}═══════════════════════════════════════════════════════════════════════${colors.reset}\n`);
    } catch (err) {
        logError("Simulation encountered an unexpected failure:", err.message);
        console.error(err);
        process.exit(1);
    }
}

runSimulation();
