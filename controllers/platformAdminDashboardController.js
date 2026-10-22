import { db } from "../src/prisma/db.js";
import { getDashboardOverview, getSummaryReport, getCampaignsReport, getChannelsReport, getLocationsReport, getTrendReport, getCustomersReport} from "./reportsController.js";
import { listCustomers } from "./customerController.js";

const orm = () => db.orm.public;

const commonChecks = async (req, res) => {
  try {
      const workspaceId = req.params.workspaceId;
      if (
        typeof workspaceId !== "string" ||
        workspaceId.trim().length === 0 ||
        workspaceId.length > 200
      ) {
        res.status(400).json({
          message: "A valid workspace id is required.",
        });
        return null;
      }
      const workspace = await orm().Workspace.where({ id: workspaceId }).first();
      if (!workspace) {
        res.status(404).json({ message: "Workspace not found." });
        return null;
      }
      return workspace;
  } catch (error) {
    console.error("platform-admin workspace lookup:", error.message);
    res.status(500).json({ message: "Internal server error while checking workspace" });
    return null;
  }
}

export const getWorkspaceDashboard = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    // const reason = String(req.query.reason ?? "").trim();
    // if (reason.length < 5) {
    //   return res.status(400).json({
    //     message: "Provide a reason of at least 5 characters.",
    //   });
    // }

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
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await listCustomers(req, res, workspace.id);
  } catch (error) {
    console.error("getCustomerReport:", error.message);
    return res.status(500).json({
      message: "Could not load customer reports.",
    });
  }
}

export const getSummaryReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getSummaryReport(req, res, workspace.id);
  } catch (error) {
    console.error("getSummaryReport:", error.message);
    return res.status(500).json({
      message: "Could not get summary report.",
    });
  }
}

export const getCampaignsReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getCampaignsReport(req, res, workspace.id);
  } catch (error) {
    console.error("getCampaignsReport:", error.message);
    return res.status(500).json({
      message: "Could not get campaigns report.",
    });
  }
}

export const getChannelsReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getChannelsReport(req, res, workspace.id);
  } catch (error) {
    console.error("getChannelsReport:", error.message);
    return res.status(500).json({
      message: "Could not get channels report.",
    });
  }
}

export const getTrendReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getTrendReport(req, res, workspace.id);
  } catch (error) {
    console.error("getTrendReport:", error.message);
    return res.status(500).json({
      message: "Could not get trend report.",
    });
  }
}

export const getLocationsReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getLocationsReport(req, res, workspace.id);
  } catch (error) {
    console.error("getLocationReport:", error.message);
    return res.status(500).json({
      message: "Could not get location report.",
    });
  }
}

export const getCustomerReportView = async (req, res) => {
  try {
    const workspace = await commonChecks(req, res);
    if (!workspace) return;
    return await getCustomersReport(req, res, workspace.id);
  } catch (error) {
    console.error("getCustomersReport:", error.message);
    return res.status(500).json({
      message: "Could not get customers report.",
    });
  }
}
