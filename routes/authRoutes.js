import express from 'express';
import { registerCompany, companyLogin} from '../controllers/authController.js';
const router = express.Router(); 
router.post('/company/register', registerCompany);
router.post('/user/login', companyLogin);

export default router;