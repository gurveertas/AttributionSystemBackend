import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { db } from './src/prisma/db.js';
import ENV from './utils/env.js';

// ── Route imports ──────────────────────────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import apiKeyRoutes from './routes/apiKeyRoutes.js';
import userRoutes from './routes/userRoutes.js';
import siteRoutes from './routes/siteRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import platformAdminRoutes from './routes/platformAdminRoutes.js';
import v1Routes from './routes/v1Routes.js';
import connectorRoutes from './routes/connectorRoutes.js';

const app = express();
app.set('trust proxy', 1);

// ── Global middleware ──────────────────────────────────────────────────────
// NOTE: Connector routes for Stripe need raw body, handled in their own router.
// The global JSON parser is applied first; Stripe route overrides it.
app.use(express.json());
app.use(cookieParser());

const allowedOrigins = [
    "https://asf-tas.vercel.app",
    "https://asftas.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            // In production you may want to reject unknown origins.
            // For now we allow all to avoid breaking connectors/webhooks.
            callback(null, true);
        }
    },
    credentials: true,
}));

// ── Dashboard / Auth / Admin routes (cookie-based auth) ────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/user', userRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/platform-admin', platformAdminRoutes);

// ── Public API (API-key-based auth) ────────────────────────────────────────
app.use('/v1', v1Routes);

// ── Inbound connector webhooks (connector-secret-based auth) ───────────────
app.use('/api/connectors', connectorRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({ message: "Attribution Platform API", version: "1.0.0" });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(ENV.PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${ENV.PORT}`);
});
