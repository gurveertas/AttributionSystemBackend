import express from 'express';
import { updateDetails } from '../controllers/userController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.patch("/update-details", protectRoute, updateDetails);

export default router;
