import { Router } from 'express';
import { usersController } from '../controllers/users.controller.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../validators/schemas.js';

/** Dashboard user accounts (stored in MySQL). Admin only. */
export const usersRoutes = Router()
  .use(requireAdmin)
  .get('/', usersController.list)
  .post('/', validateBody(createUserSchema), usersController.create)
  .patch('/:id', validateBody(updateUserSchema), usersController.update)
  .delete('/:id', usersController.remove);
