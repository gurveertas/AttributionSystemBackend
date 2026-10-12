import express from 'express';
import { registerCompany, companyLogin, sendMe, userLogout} from '../controllers/authController.js';
const router = express.Router(); 
router.post('/company/register', registerCompany);
router.post('/user/login', companyLogin);
router.get('/me', sendMe);
router.post('/logout', userLogout)

export default router;