import { db } from "../src/prisma/db.js";
import { getDashboardOverview } from "./reportsController.js";
import { listCustomers } from "./customerController.js";

const orm = () => db.orm.public;

export const getWorkspaceDashboard = async (req, res) => {
  try {
    if (req.user?.role !== "platform_admin") {
      return res.status(403).json({ message: "Platform admins only" });
    }

    const workspaceId = req.params.workspaceId;
    if (
      typeof workspaceId !== "string" ||
      workspaceId.trim().length === 0 ||
      workspaceId.length > 200
    ) {
      return res.status(400).json({
        message: "A valid workspace id is required.",
      });
    }

    // const reason = String(req.query.reason ?? "").trim();
    // if (reason.length < 5) {
    //   return res.status(400).json({
    //     message: "Provide a reason of at least 5 characters.",
    //   });
    // }

    const workspace = await orm().Workspace.where({ id: workspaceId }).first();
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    // await orm().AuditLog.create({
    //   workspaceId: workspace.id,
    //   actorType: "platform_admin",
    //   actorUserId: req.user.id,
    //   action: "admin.workspace_dashboard_viewed",
    //   targetType: "workspace",
    //   targetId: workspace.id,
    //   reason,
    //   ip: req.ip ?? null,
    //   userAgent: req.headers["user-agent"] ?? null,
    // });

    return await getDashboardOverview(req, res, workspace.id);
  } catch (error) {
    console.error("getWorkspaceDashboard:", error.message);
    return res.status(500).json({
      message: "Could not load workspace dashboard.",
    });
  }
};

export const listCustomerView = async (req, res) => {
  try {
    if (req.user?.role !== "platform_admin") {
      return res.status(403).json({ message: "Platform admins only" });
    }

    const workspaceId = req.params.workspaceId;
    if (
      typeof workspaceId !== "string" ||
      workspaceId.trim().length === 0 ||
      workspaceId.length > 200
    ) {
      return res.status(400).json({
        message: "A valid workspace id is required.",
      });
    }
    const workspace = await orm().Workspace.where({ id: workspaceId }).first();
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }
    return await listCustomers(req, res, workspace.id);
  } catch (error) {
    console.error("getCustomerReport:", error.message);
    return res.status(500).json({
      message: "Could not load customer reports.",
    });
  }
}
