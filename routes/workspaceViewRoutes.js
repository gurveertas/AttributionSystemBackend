import express from "express";
const router = express.Router();
import { protectRoute } from "../middlewares/protectRoute.js";
import { getWorkspaceDashboard, getWorkspaceCustomersReport } from "../controllers/platformAdminDashboardController.js";

router.get('/workspace/:workspaceId', protectRoute, getWorkspaceDashboard);

router.get('/customers/workspace/:workspaceId', protectRoute, getWorkspaceCustomersReport);

export default router;