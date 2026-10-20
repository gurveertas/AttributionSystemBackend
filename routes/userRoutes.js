import express from 'express';
import { addMember, updateDetails, deleteUser} from '../controllers/userController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.post('/add-member', protectRoute, addMember);

router.patch("/update-details", protectRoute, updateDetails);

router.delete('/:userId', protectRoute, deleteUser);



export default router;
