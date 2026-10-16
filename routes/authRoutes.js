import express from 'express';
import { registerCompany, companyLogin, sendMe, userLogout, verifyUser, forgotPass, resetPassword } from '../controllers/authController.js';

const router = express.Router(); 
router.post('/company/register', registerCompany);
router.post('/user/login', companyLogin);
router.post('/verify-user', verifyUser);
router.post('/user/forgotpass', forgotPass);
router.post('/user/reset-password', resetPassword);
router.post('/reset-password', resetPassword);
router.get('/me', sendMe);
router.post('/logout', userLogout);

export default router;