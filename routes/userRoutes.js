import express from 'express';
import { addMember, deleteUser, updateMember, addPlatformAdmin } from '../controllers/userController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.post('/add-member', protectRoute, addMember);
router.post('/add-platform-admin', protectRoute, requireRole('platform_admin'), addPlatformAdmin);

router.patch("/:userId", protectRoute, updateMember);

router.delete('/:userId', protectRoute, deleteUser);



export default router;
