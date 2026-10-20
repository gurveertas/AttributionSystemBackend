import express from "express";
const router = express.Router();
import { protectRoute } from "../middlewares/protectRoute.js";
import { getSummaryReportView, getWorkspaceDashboard, listCustomerView,getCampaignReportView, getChannelsReportView, getLocationReportView, getTrendReportView, getCustomerReportView } from "../controllers/platformAdminDashboardController.js";

router.get('/workspace/:workspaceId', protectRoute, getWorkspaceDashboard);

router.get('/customers/workspace/:workspaceId', protectRoute, listCustomerView);

router.get('/reports/summary/:workspaceId', protectRoute, getSummaryReportView);

router.get('/reports/channels/:workspaceId', protectRoute, getChannelsReportView);

router.get('/reports/campaigns/:workspaceId', protectRoute, getCampaignReportView);

router.get('/reports/locations/:workspaceId', protectRoute, getLocationReportView);

router.get('/reports/trends/:workspaceId', protectRoute, getTrendReportView);

router.get('/reports/customers/:workspaceId', protectRoute, getCustomerReportView);




export default router;