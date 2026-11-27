import { Router, type NextFunction, type Request, type Response } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../utils/http.js';
import {
  admsSettingsSchema,
  appearanceSettingsSchema,
  biotimeSettingsSchema,
  companySettingsSchema,
  syncSettingsSchema,
  zkDeviceSchema,
  zkDeviceTestSchema,
} from '../validators/schemas.js';

const sectionSchemas = { biotime: biotimeSettingsSchema, adms: admsSettingsSchema, sync: syncSettingsSchema, company: companySettingsSchema, appearance: appearanceSettingsSchema };

/** Validate the body with the schema of the section in the URL. */
function validateSection(req: Request, res: Response, next: NextFunction) {
  const schema = sectionSchemas[req.params.section as keyof typeof sectionSchemas];
  if (!schema) return next(new HttpError(404, 'Unknown settings section'));
  return validateBody(schema)(req, res, next);
}

/** Settings page: devices, BioTime, ADMS push, sync. Stored in MySQL. Admin only. */
export const settingsRoutes = Router()
  .use(requireAdmin)
  .get('/', settingsController.get)
  .post('/biotime/test', validateBody(biotimeSettingsSchema), settingsController.testBiotime)
  .get('/devices', settingsController.listDevices)
  .post('/devices', validateBody(zkDeviceSchema), settingsController.createDevice)
  .post('/devices/test', validateBody(zkDeviceTestSchema), settingsController.testAddress)
  .post('/devices/scan', settingsController.scan)
  .put('/devices/:id', validateBody(zkDeviceSchema), settingsController.updateDevice)
  .delete('/devices/:id', settingsController.removeDevice)
  .post('/devices/:id/test', settingsController.testDevice)
  .put('/:section', validateSection, settingsController.update);
