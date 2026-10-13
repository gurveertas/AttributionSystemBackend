// routes/siteRoutes.js
import { Router } from "express";
import { protectRoute, requireRole } from "../middlewares/protectRoute.js";
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

router.post("/", protectRoute, addSite);
router.get("/", protectRoute, listSites);
router.get("/:id", protectRoute, getSite);
router.patch("/:id", protectRoute, updateSite);
router.delete("/:id", protectRoute, deleteSite);
router.post("/:id/verify-domain", protectRoute, verifySite);

export default router;