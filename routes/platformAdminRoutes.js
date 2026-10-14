import express from "express";
import {
  getPlatformDashboard,
  listWorkspaces,
  getWorkspaceDetails,
  setWorkspaceStatus,
  updateWorkspaceSettings,
  listWorkspaceUsers,
  updateUser,
  listPlatformApiKeys,
  revokePlatformApiKey,
  listPlatformConnectors,
  setConnectorStatus,
  listPlatformWebhooks,
  updatePlatformWebhook,
} from "../controllers/platformAdminController.js";

import { protectRoute, requireRole } from "../middlewares/protectRoute.js";

const router = express.Router();

// All routes require an authenticated platform admin.
router.use(protectRoute);
router.use(requireRole("platform_admin"));

router.get("/dashboard", getPlatformDashboard);

router.get("/workspaces", listWorkspaces);
router.get("/workspaces/:workspaceId", getWorkspaceDetails);
router.patch("/workspaces/:workspaceId/status", setWorkspaceStatus);
router.patch("/workspaces/:workspaceId/settings", updateWorkspaceSettings);
router.get("/workspaces/:workspaceId/users", listWorkspaceUsers);

router.patch("/users/:userId", updateUser);

router.get("/api-keys", listPlatformApiKeys);
router.post("/api-keys/:keyId/revoke", revokePlatformApiKey);

router.get("/connectors", listPlatformConnectors);
router.patch("/connectors/:connectorId/status", setConnectorStatus);

router.get("/webhooks", listPlatformWebhooks);
router.patch("/webhooks/:webhookId", updatePlatformWebhook);

export default router;
