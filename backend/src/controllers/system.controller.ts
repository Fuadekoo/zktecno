import type { Request, Response } from 'express';
import { adms } from '../adms/server.js';
import { biotime } from '../biotime/client.js';
import { config } from '../config.js';
import { auditRepo } from '../repositories/audit.js';
import { devicesRepo } from '../repositories/devices.js';
import { employeesRepo } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { SYNC_JOBS, syncRunsRepo, type SyncJob } from '../repositories/syncRuns.js';
import { syncService, type JobResult } from '../services/sync.service.js';
import { pagination, str } from '../utils/http.js';
import { zk } from '../zk/client.js';

export const systemController = {
  async status(_req: Request, res: Response) {
    const [jobs, punches, employees, devices] = await Promise.all([
      syncRunsRepo.summary(),
      punchesRepo.stats(),
      employeesRepo.counts(),
      devicesRepo.count(),
    ]);
    res.json({
      biotime: { server: config.biotime.baseUrl, auth_type: config.biotime.authType, user: config.biotime.username },
      database: { host: config.db.host, port: config.db.port, name: config.db.database },
      direct_devices: zk.devices().map((d) => `${d.ip}:${d.port}`),
      adms: {
        enabled: config.adms.enabled,
        port: config.adms.port,
        forward_to: config.adms.forward ? config.adms.forwardUrl : null,
        devices: adms.devices(),
      },
      sync: {
        enabled: config.sync.enabled,
        interval_seconds: config.sync.intervalSeconds,
        employees_minutes: config.sync.employeesMinutes,
        lookback_hours: config.sync.lookbackHours,
        running: syncService.isRunning(),
        jobs: jobs.map((j) => ({ ...j, is_running: syncService.isRunning(j.job) })),
      },
      totals: { punches: punches.total, first_punch: punches.first, last_punch: punches.last, employees: employees.total, devices },
    });
  },

  /** Sync history: every run saved in the database. */
  async runs(req: Request, res: Response) {
    const { pageSize, offset } = pagination(req.query, 25);
    const job = str(req.query.job) as SyncJob | undefined;
    res.json(await syncRunsRepo.page(pageSize, offset, job && SYNC_JOBS.includes(job) ? job : undefined));
  },

  async biotimeHealth(_req: Request, res: Response) {
    res.json({ ...(await biotime.ping()), server: config.biotime.baseUrl, authType: config.biotime.authType });
  },

  /** Live status of every device in ZK_DEVICES, read directly with zkteco-js (checked one at a time). */
  async zkDevices(_req: Request, res: Response) {
    const devices = [];
    for (const d of zk.devices()) devices.push(await zk.status(d));
    res.json({ enabled: zk.enabled(), devices });
  },

  /** Manual sync. Waits for the result so the UI can show what happened. */
  async sync(req: Request, res: Response) {
    const { job, start_date, end_date } = req.body as { job: 'all' | SyncJob; start_date?: string; end_date?: string };
    let results: JobResult[];
    if (start_date && end_date && job === 'device_punches') results = [await syncService.syncDevicePunches('range', { startDate: start_date, endDate: end_date })];
    else if (start_date && end_date) results = [await syncService.resyncPunches(start_date, end_date)];
    else if (job === 'device_punches') results = [await syncService.syncDevicePunches('manual')];
    else if (job === 'devices') results = [await syncService.syncDevices('manual')];
    else if (job === 'employees') results = [await syncService.syncEmployees('manual')];
    else if (job === 'punches') results = [await syncService.syncPunches('manual')];
    else results = await syncService.runCycle({ trigger: 'manual', forceEmployees: true });

    const range = start_date ? ` ${start_date} to ${end_date}` : '';
    await auditRepo.log(req, {
      action: 'sync',
      entity: 'system',
      summary: `Manual sync (${start_date ? (job === 'device_punches' ? job : 'punches') : job})${range}: ${results
        .map((r) => (r.ok ? `${r.job} ${r.fetched} (${r.created} new)` : `${r.job} failed`))
        .join(', ')}`,
    });
    res.json({ ok: results.every((r) => r.ok), results });
  },

  async audit(req: Request, res: Response) {
    const { pageSize, offset } = pagination(req.query, 50);
    res.json(await auditRepo.page(pageSize, offset, str(req.query.entity)));
  },
};
