import { Router } from 'express';
import { deviceControlController as c } from '../controllers/deviceControl.controller.js';
import { adminForWrites } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { deviceActionSchema, enrollSchema } from '../validators/schemas.js';

/**
 * Talking to devices (BioTime off): the command queue.
 *   GET  /devices                     devices with live state and what they can do
 *   POST /devices/:id/commands        fetch punches / fetch users / send all employees / reboot / check
 *   GET  /commands                    command log (filter: device_id, emp_code, status, kind)
 *   POST /commands/:id/retry|cancel
 *   GET  /employees/:id               one person on every device + fingerprints/faces
 *   POST /employees/:id/push          send the person to every device again
 *   POST /employees/:id/enroll        start fingerprint enrollment on a push device
 */
export const deviceControlRoutes = Router()
  .use(adminForWrites)
  .get('/devices', c.devices)
  .post('/devices/:id/commands', validateBody(deviceActionSchema), c.run)
  .get('/commands', c.commands)
  .post('/commands/:id/retry', c.retry)
  .post('/commands/:id/cancel', c.cancel)
  .get('/employees/:id', c.employee)
  .post('/employees/:id/push', c.pushEmployee)
  .post('/employees/:id/enroll', validateBody(enrollSchema), c.enroll);
