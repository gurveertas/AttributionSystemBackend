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
router.post('/', protectRoute, requireRole(['comapany_admin']), createApiKey);

router.get('/', listApiKeys);

router.patch('/:id', updateApiKey);

router.delete('/:id', revokeApiKey);

router.post('/rotate', rotateApiKey);

export default router;
