import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { changePasswordSchema, loginSchema } from '../validators/schemas.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

export const authRoutes = Router()
  .post('/login', loginLimiter, validateBody(loginSchema), authController.login)
  .post('/logout', authController.logout)
  .get('/me', requireAuth, authController.me)
  .post('/change-password', requireAuth, validateBody(changePasswordSchema), authController.changePassword);
