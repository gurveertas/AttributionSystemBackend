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

router.get("/companies/:companyId/api-keys", protectRoute, requireRole("platform_admin"), adminListApiKeys);

export default router;
