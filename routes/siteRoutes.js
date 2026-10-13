// routes/siteRoutes.js
import { Router } from "express";
import { protectRoute, requireRole } from "../middleware/protectRoute.js";
import {
    addSite,
    listSites,
    getSite,
    updateSite,
    deleteSite,
    verifySite,
} from "../controllers/siteController.js";

const router = Router();

// Every site route needs a login and a company admin
router.use(protectRoute, requireRole("company_admin"));

router.post("/", addSite);
router.get("/", listSites);
router.get("/:id", getSite);
router.patch("/:id", updateSite);
router.delete("/:id", deleteSite);
router.post("/:id/verify-domain", verifySite);

export default router;