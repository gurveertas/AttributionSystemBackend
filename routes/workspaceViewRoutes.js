import express from "express";
const router = express.Router();
import { getWorkspaceDashboard, getWorkspaceCustomersReport } from "../controllers/platformAdminDashboardController.js";

router.get('/workspace/:workspaceId', getWorkspaceDashboard);

router.get('/customers/workspace/:workspaceId', getWorkspaceCustomersReport);

export default router;