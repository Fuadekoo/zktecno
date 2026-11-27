import { Router } from 'express';
import { dashboardController, reportsController, transactionsController } from '../controllers/attendance.controllers.js';

// All read from the MySQL mirror that the sync job keeps up to date.
export const dashboardRoutes = Router().get('/', dashboardController.get).get('/analytics', dashboardController.analytics);

export const transactionsRoutes = Router()
  .get('/', transactionsController.list)
  .get('/export', transactionsController.export);

export const reportsRoutes = Router()
  .get('/daily', reportsController.daily)
  .get('/daily/export', reportsController.dailyExport);
