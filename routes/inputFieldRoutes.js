import express from 'express';
import { getIndustryList, getPaymentMethod } from '../controllers/inputFieldsController';

const router = express.Router();

router.get('/gateways', getPaymentMethod);
router.get('/industries', getIndustryList);

export default router;