import express from 'express';
import { addMember, deleteUser, updateMember} from '../controllers/userController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.post('/add-member', protectRoute, requireRole("company_admin"), addMember);

router.patch("/:userId", protectRoute, requireRole("company_admin"), updateMember);

router.delete('/:userId', protectRoute, requireRole("company_admin"), deleteUser);



export default router;
