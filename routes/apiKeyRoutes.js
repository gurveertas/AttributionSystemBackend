import express from 'express';
import {
  createApiKey,
  listApiKeys,
  updateApiKey,
  revokeApiKey,
  rotateApiKey,
} from '../controllers/apiKeyController.js';
import {protectRoute, requireRole} from '../middlewares/protectRoute.js'

const router = express.Router();

router.post('/', protectRoute, createApiKey);

router.get('/', protectRoute, listApiKeys);

router.patch('/:id', protectRoute, updateApiKey);

router.delete('/:id', protectRoute, revokeApiKey);

router.post('/rotate',protectRoute, rotateApiKey);

export default router;
