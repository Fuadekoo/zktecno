import { Router } from 'express';
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
import { settingsRoutes } from './settings.routes.js';
import { systemRoutes } from './system.routes.js';
import { usersRoutes } from './users.routes.js';
import { webhooksRoutes } from './webhooks.routes.js';

/**
 * API map (all under /api):
 *   /health                 public liveness check
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
    .get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
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
