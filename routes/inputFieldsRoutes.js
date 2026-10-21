import express from 'express';
import { getIndustryList, getPaymentMethod, addIndustry, addPaymentGateway} from '../controllers/inputFieldsController.js';

const router = express.Router();

router.get('/gateways', getPaymentMethod);
router.get('/industries', getIndustryList);
router.post("/industries", addIndustry);
router.post("/gateways", addPaymentGateway);

export default router;