import { Router } from 'express';
import { healthController } from '../controllers/health.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { dashboardRoutes, reportsRoutes, transactionsRoutes } from './attendance.routes.js';
import { authRoutes } from './auth.routes.js';
import { deviceControlRoutes } from './deviceControl.routes.js';
import {
  areasRoutes,
  departmentsRoutes,
  devicesRoutes,
  employeesRoutes,
  positionsRoutes,
} from './personnel.routes.js';
import { settingsService } from '../services/settings.service.js';
import { settingsRoutes } from './settings.routes.js';
import { systemRoutes } from './system.routes.js';
import { usersRoutes } from './users.routes.js';
import { webhooksRoutes } from './webhooks.routes.js';

/**
 * API map (all under /api):
 *   /health                 public liveness check (process is up)
 *   /health/ready           public readiness check (MySQL reachable; 503 if not)
 *   /branding               public: company name, logo, theme colours
 *   /auth                   login, logout, me, change-password
 *   ---- signed-in users below ----
 *   /dashboard              today's overview            (MySQL)
 *   /transactions           punch logs + CSV export     (MySQL)
 *   /reports                daily attendance + CSV      (MySQL)
 *   /employees, /departments, /areas, /positions        (BioTime live; writes = admin)
 *   /devices                device list                 (BioTime live)
 *   /device-control         device command queue: add/remove people, fetch data, enroll (BioTime off)
 *   /system                 sync status, sync history, manual sync, audit log
 *   /webhooks               outgoing webhooks + delivery log (MySQL, admin)
 *   /settings               devices, BioTime, ADMS, sync (MySQL, admin)
 *   /users                  dashboard accounts          (MySQL, admin)
 */
export function apiRoutes() {
  return Router()
    .get('/health', healthController.live)
    .get('/health/ready', healthController.ready)
    // Name, logo and colours for every page, also the login page (no private details)
    .get('/branding', (_req, res) => res.json(settingsService.branding()))
    .use('/auth', authRoutes)
    .use(requireAuth)
    .use('/dashboard', dashboardRoutes)
    .use('/transactions', transactionsRoutes)
    .use('/reports', reportsRoutes)
    .use('/employees', employeesRoutes)
    .use('/departments', departmentsRoutes)
    .use('/areas', areasRoutes)
    .use('/positions', positionsRoutes)
    .use('/devices', devicesRoutes)
    .use('/device-control', deviceControlRoutes)
    .use('/system', systemRoutes)
    .use('/settings', settingsRoutes)
    .use('/users', usersRoutes)
    .use('/webhooks', webhooksRoutes);
}
