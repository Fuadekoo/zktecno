import { Router } from 'express';
import { systemController } from '../controllers/system.controller.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { syncRequestSchema } from '../validators/schemas.js';

export const systemRoutes = Router()
  .get('/status', systemController.status)
  .get('/biotime-health', systemController.biotimeHealth)
  .get('/zk-devices', systemController.zkDevices)
  .get('/sync-runs', systemController.runs)
  .post('/sync', requireAdmin, validateBody(syncRequestSchema), systemController.sync)
  .get('/audit', requireAdmin, systemController.audit);
