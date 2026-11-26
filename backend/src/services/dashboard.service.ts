import { config } from '../config.js';
import { devicesRepo } from '../repositories/devices.js';
import { employeesRepo } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { syncRunsRepo } from '../repositories/syncRuns.js';
import { localDate } from '../utils/http.js';
import { syncService } from './sync.service.js';

/** Today's overview, read entirely from MySQL (fast, and works while BioTime is briefly down). */
export async function getDashboard() {
  const today = localDate();
  const from = `${today} 00:00:00`;
  const to = `${today} 23:59:59`;

  const [devices, employees, day, absent, recent, jobs] = await Promise.all([
    devicesRepo.all(),
    employeesRepo.counts(),
    punchesRepo.daySummary(from, to),
    punchesRepo.absentCount(from, to),
    punchesRepo.latest(12, { from, to }),
    syncRunsRepo.summary(),
  ]);

  const punchJob = jobs.find((j) => j.job === 'punches');

  return {
    date: today,
    devices: {
      total: devices.length,
      online: devices.filter((d) => Number(d.state) === 1).length,
      list: devices,
    },
    employees,
    today: { punches: day.punches, present: day.people, absent, hourly: day.hourly, recent },
    sync: {
      enabled: config.sync.enabled,
      interval_seconds: config.sync.intervalSeconds,
      running: syncService.isRunning(),
      last_success_at: punchJob?.last_success_at ?? null,
      last_error: jobs.find((j) => j.last_error)?.last_error ?? null,
      never_synced: !punchJob?.last_success_at,
    },
  };
}
