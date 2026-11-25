import { Router } from 'express';
import { webhooksController as c } from '../controllers/webhooks.controller.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createWebhookSchema, updateWebhookSchema } from '../validators/schemas.js';

/** Outgoing webhooks and their delivery log (all stored in PostgreSQL). Admin only. */
export const webhooksRoutes = Router()
  .use(requireAdmin)
  .get('/', c.list)
  .post('/', validateBody(createWebhookSchema), c.create)
  .get('/deliveries', c.deliveries)
  .get('/deliveries/:id', c.delivery)
  .post('/deliveries/:id/redeliver', c.redeliver)
  .get('/:id', c.get)
  .patch('/:id', validateBody(updateWebhookSchema), c.update)
  .delete('/:id', c.remove)
  .post('/:id/test', c.test);
