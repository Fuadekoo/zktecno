import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dashboardRoutes, reportsRoutes, transactionsRoutes } from './attendance.routes.js';
import { authRoutes } from './auth.routes.js';
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
 *   /dashboard              today's overview            (PostgreSQL)
 *   /transactions           punch logs + CSV export     (PostgreSQL)
 *   /reports                daily attendance + CSV      (PostgreSQL)
 *   /employees, /departments, /areas, /positions        (BioTime live; writes = admin)
 *   /devices                device list                 (BioTime live)
 *   /system                 sync status, sync history, manual sync, audit log
 *   /webhooks               outgoing webhooks + delivery log (PostgreSQL, admin)
 *   /settings               devices, BioTime, ADMS, sync (PostgreSQL, admin)
 *   /users                  dashboard accounts          (PostgreSQL, admin)
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
    .use('/system', systemRoutes)
    .use('/settings', settingsRoutes)
    .use('/users', usersRoutes)
    .use('/webhooks', webhooksRoutes);
}
