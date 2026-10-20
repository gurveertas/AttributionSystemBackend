import express from 'express';
import { addMember, deleteUser, updateMember} from '../controllers/userController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.post('/add-member', protectRoute, addMember);

router.patch("/:userId", protectRoute, updateMember);

router.delete('/:userId', protectRoute, deleteUser);



export default router;
