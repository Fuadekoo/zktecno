import { Router } from 'express';
import type { z } from 'zod';
import type { biotimeResourceController } from '../controllers/biotimeResource.controller.js';
import {
  areasController,
  departmentsController,
  devicesController,
  employeesController,
  positionsController,
} from '../controllers/personnel.controllers.js';
import { adminForWrites } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  areaSchema,
  departmentSchema,
  employeeSchema,
  employeeUpdateSchema,
  positionSchema,
} from '../validators/schemas.js';

type Controller = ReturnType<typeof biotimeResourceController>;

/** list / all / get, plus create / update / delete when schemas are given. */
function resourceRoutes(c: Controller, schemas?: { create: z.ZodType; update: z.ZodType }) {
  const router = Router().use(adminForWrites).get('/', c.list).get('/all', c.all).get('/:id', c.get);
  if (schemas) {
    router
      .post('/', validateBody(schemas.create), c.create)
      .patch('/:id', validateBody(schemas.update), c.update)
      .delete('/:id', c.remove);
  }
  return router;
}

const partial = (s: z.ZodObject) => s.partial();

// Devices are read-only here: they are added/removed in BioTime itself.
export const devicesRoutes = resourceRoutes(devicesController);
export const employeesRoutes = resourceRoutes(employeesController, { create: employeeSchema, update: employeeUpdateSchema });
export const departmentsRoutes = resourceRoutes(departmentsController, { create: departmentSchema, update: partial(departmentSchema) });
export const areasRoutes = resourceRoutes(areasController, { create: areaSchema, update: partial(areaSchema) });
export const positionsRoutes = resourceRoutes(positionsController, { create: positionSchema, update: partial(positionSchema) });
