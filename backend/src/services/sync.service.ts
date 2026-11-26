import { biotime } from '../biotime/client.js';
import { ENDPOINTS } from '../biotime/endpoints.js';
import type { BtEmployee, BtTerminal, BtTransaction } from '../biotime/types.js';
import { config } from '../config.js';
import { dbNow, fromDb, toDb } from '../db/time.js';
import { devicesRepo } from '../repositories/devices.js';
import { employeesRepo } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { syncRunsRepo, type SyncJob, type SyncTrigger } from '../repositories/syncRuns.js';
import { webhooksRepo } from '../repositories/webhooks.js';
import { localDate, localDateTime } from '../utils/http.js';
import { zk, type ZkUser } from '../zk/client.js';
import { webhookService } from './webhook.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Large ranges are fetched in chunks to keep memory flat. */
const CHUNK_DAYS = 7;
/** Sync history kept for this many days. */
const KEEP_RUNS_DAYS = 90;

export interface JobResult {
  job: SyncJob;
  run_id: number | null;
  ok: boolean;
  fetched: number;
  created: number;
  count: number;
  webhooks_queued: number;
  error?: string;
  ms: number;
}

interface JobOutcome {
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  rangeFrom?: Date | null;
  rangeTo?: Date | null;
  cursorAt?: Date | null;
  /** New punch ids to announce through webhooks */
  newPunchIds?: number[];
  /** Saved on a successful run as a warning (e.g. one device of several was unreachable) */
  error?: string | null;
}

const PUNCH_JOBS: SyncJob[] = ['punches', 'device_punches'];

class SyncService {
  private jobs = new Map<SyncJob, Promise<JobResult>>();
  private timer: NodeJS.Timeout | null = null;
  private cycle: Promise<JobResult[]> | null = null;
  private lastEmployeeSyncAt = 0;
  private employeeSyncTimer: NodeJS.Timeout | null = null;
  private lastPruneAt = 0;
  /** BioTime and direct-device punch writes run one at a time, so cross-source de-duplication is reliable. */
  private punchWrites: Promise<unknown> = Promise.resolve();

  /** Also used by the ADMS push receiver, so pushes and sync runs never race on de-duplication. */
  exclusivePunchWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.punchWrites.then(fn, fn);
    this.punchWrites = next.catch(() => {});
    return next;
  }

  start() {
    if (!config.sync.enabled) {
      console.log('[sync] Automatic sync is off (Settings > Sync). Use "Sync now" in the dashboard.');
      return;
    }
    console.log(`[sync] Every ${config.sync.intervalSeconds}s (employees every ${config.sync.employeesMinutes} min)`);
    if (!config.biotime.enabled) console.log('[sync] BioTime off: using direct device reads and ADMS push only');
    if (zk.enabled()) console.log(`[sync] Also reading ${zk.devices().length} device(s) directly: ${zk.devices().map((d) => `${d.name} (${d.ip}:${d.port})`).join(', ')}`);
    setTimeout(() => void this.runCycle({ trigger: 'startup' }), 1500).unref();
    this.timer = setInterval(() => void this.runCycle({ trigger: 'schedule' }), config.sync.intervalSeconds * 1000);
    this.timer.unref();
  }

  /** Apply new sync settings: restart the timer (and run a cycle now if enabled). */
  restart() {
    this.stop();
    this.start();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.employeeSyncTimer) clearTimeout(this.employeeSyncTimer);
    this.timer = null;
  }

  isRunning(job?: SyncJob) {
    return job ? this.jobs.has(job) : this.jobs.size > 0 || this.cycle !== null;
  }

  /** Devices, employees (when due or forced), then punches. Overlapping cycles share one run. */
  runCycle({ trigger, forceEmployees = false }: { trigger: SyncTrigger; forceEmployees?: boolean }): Promise<JobResult[]> {
    if (this.cycle) return this.cycle;
    this.cycle = (async () => {
      const results: JobResult[] = [];
      if (config.biotime.enabled) {
        results.push(await this.syncDevices(trigger));
        const employeesDue = Date.now() - this.lastEmployeeSyncAt >= config.sync.employeesMinutes * 60_000;
        if (forceEmployees || employeesDue) results.push(await this.syncEmployees(trigger));
        results.push(await this.syncPunches(trigger));
      } else if (zk.enabled()) {
        const employeesDue = Date.now() - this.lastEmployeeSyncAt >= config.sync.employeesMinutes * 60_000;
        if (forceEmployees || employeesDue) results.push(await this.syncEmployees(trigger));
      }
      if (zk.enabled()) results.push(await this.syncDevicePunches(trigger));
      for (const r of results) if (!r.ok) console.warn(`[sync] ${r.job} failed: ${r.error}`);
      await this.pruneIfDue();
      return results;
    })().finally(() => {
      this.cycle = null;
    });
    return this.cycle;
  }

  /** After employee/department changes: refresh the mirror shortly, coalescing bursts of edits. */
  requestEmployeeSync() {
    if (!config.biotime.enabled) return;
    if (this.employeeSyncTimer) clearTimeout(this.employeeSyncTimer);
    this.employeeSyncTimer = setTimeout(() => {
      this.employeeSyncTimer = null;
      void this.syncEmployees('personnel_change');
    }, 1000);
    this.employeeSyncTimer.unref();
  }

  /** Runs one job, recording it in sync_runs. Concurrent calls for the same job share one run. */
  private runJob(job: SyncJob, trigger: SyncTrigger, fn: (runId: number) => Promise<JobOutcome>): Promise<JobResult> {
    const existing = this.jobs.get(job);
    if (existing) return existing;
    const started = Date.now();
    const run = (async (): Promise<JobResult> => {
      let runId: number | null = null;
      try {
        runId = (await syncRunsRepo.start(job, trigger)).id;
        const outcome = await fn(runId);
        const { newPunchIds, ...stats } = outcome;
        const finished = await syncRunsRepo.finish(runId, started, stats);

        let queued = 0;
        if (PUNCH_JOBS.includes(job)) {
          if (newPunchIds?.length) queued += await webhookService.queuePunches(await punchesRepo.byIds(newPunchIds), runId);
          queued += await webhookService.queueSyncResult(finished);
          if (queued) await syncRunsRepo.setWebhooksQueued(runId, queued);
        }
        return { job, run_id: runId, ok: true, fetched: stats.fetched, created: stats.created, count: stats.fetched, webhooks_queued: queued, ms: Date.now() - started };
      } catch (err) {
        const message = (err as Error).message || String(err);
        let queued = 0;
        if (runId !== null) {
          const failed = await syncRunsRepo.fail(runId, started, message).catch(() => null);
          if (failed && PUNCH_JOBS.includes(job)) {
            queued = await webhookService.queueSyncResult(failed).catch(() => 0);
            if (queued) await syncRunsRepo.setWebhooksQueued(runId, queued).catch(() => {});
          }
        }
        return { job, run_id: runId, ok: false, fetched: 0, created: 0, count: 0, webhooks_queued: queued, error: message, ms: Date.now() - started };
      }
    })().finally(() => this.jobs.delete(job));
    this.jobs.set(job, run);
    return run;
  }

  syncDevices(trigger: SyncTrigger = 'manual') {
    return this.runJob('devices', trigger, async () => {
      const syncedAt = dbNow();
      const list = await biotime.listAll<BtTerminal>(ENDPOINTS.terminals);
      const r = await devicesRepo.replaceAll(list, syncedAt);
      return { fetched: list.length, ...r };
    });
  }

  syncEmployees(trigger: SyncTrigger = 'manual') {
    if (!config.biotime.enabled) return this.syncEmployeesFromDevices(trigger);
    return this.runJob('employees', trigger, async () => {
      const syncedAt = dbNow();
      const list = await biotime.listAll<BtEmployee>(ENDPOINTS.employees);
      const r = await employeesRepo.upsertMany(list, syncedAt);
      const removed = await employeesRepo.markMissingAsDeleted(syncedAt);
      this.lastEmployeeSyncAt = Date.now();
      return { fetched: list.length, ...r, removed };
    });
  }

  /**
   * Without BioTime: the employee list is the users enrolled on the Pull/Both devices in Settings.
   * A user on several devices is saved once. Users missing from every device are marked deleted,
   * but only when all devices were read, so one offline device doesn't wipe its users.
   */
  private syncEmployeesFromDevices(trigger: SyncTrigger) {
    return this.runJob('employees', trigger, async () => {
      if (!zk.enabled()) throw new Error('BioTime is off and no devices are set up for reading. Add one in Settings > Devices (mode Pull or Both).');
      const syncedAt = dbNow();
      const byCode = new Map<string, ZkUser>();
      const failures: string[] = [];
      for (const device of zk.devices()) {
        try {
          const users = await zk.readUsers(device);
          for (const u of users) {
            const seen = byCode.get(u.emp_code);
            byCode.set(u.emp_code, { emp_code: u.emp_code, name: seen?.name || u.name, card_no: seen?.card_no || u.card_no });
          }
          console.log(`[sync] Device ${device.ip}: ${users.length} users`);
        } catch (err) {
          failures.push((err as Error).message);
        }
      }
      if (failures.length === zk.devices().length) throw new Error(failures.join('; '));
      const list = [...byCode.values()];
      const r = await employeesRepo.upsertFromDevice(list, syncedAt);
      const removed = failures.length ? 0 : await employeesRepo.markMissingAsDeleted(syncedAt, { keepCreatedInApp: true });
      this.lastEmployeeSyncAt = Date.now();
      return { fetched: list.length, ...r, removed, error: failures.length ? `Some devices failed: ${failures.join('; ')}` : null };
    });
  }

  /**
   * Incremental punch sync. Reads from the last successful run minus the look-back hours,
   * so punches that offline devices upload late are still caught. The very first run imports
   * the first-import days of history and does not fire webhooks (it's history, not news).
   */
  syncPunches(trigger: SyncTrigger = 'manual') {
    return this.runJob('punches', trigger, async (runId) => {
      const now = new Date();
      const cursor = await syncRunsRepo.punchCursor();
      const initialImport = !cursor;
      let from: Date;
      if (initialImport) {
        from = new Date(`${localDate(new Date(now.getTime() - (config.sync.initialDays - 1) * DAY))}T00:00:00`);
        console.log(`[sync] First punch sync: importing from ${localDate(from)} (first-import days: ${config.sync.initialDays})`);
      } else {
        // cursor holds wall-clock time; convert back to a real instant for the window maths.
        from = new Date(new Date(fromDb(cursor).replace(' ', 'T')).getTime() - config.sync.lookbackHours * HOUR);
      }
      // Read a day past "now" so devices with a fast clock aren't missed.
      const to = new Date(now.getTime() + DAY);
      const r = await this.importPunches(from, to, runId);
      return {
        ...r,
        rangeFrom: toDb(localDateTime(from)),
        rangeTo: toDb(localDateTime(to)),
        cursorAt: toDb(localDateTime(now)),
        newPunchIds: initialImport ? [] : r.newPunchIds,
      };
    });
  }

  /** Re-import a date range (e.g. after a device uploaded an old backlog). New punches fire webhooks. */
  resyncPunches(startDate: string, endDate: string) {
    return this.runJob('punches', 'range', async (runId) => {
      const from = new Date(`${startDate}T00:00:00`);
      const to = new Date(`${endDate}T23:59:59`);
      const r = await this.importPunches(from, to, runId);
      // No cursorAt: the incremental sync keeps going from where it was.
      return { ...r, rangeFrom: toDb(`${startDate} 00:00:00`), rangeTo: toDb(`${endDate} 23:59:59`) };
    });
  }

  private async importPunches(from: Date, to: Date, runId: number) {
    let fetched = 0;
    const newPunchIds: number[] = [];
    for (let chunkStart = from.getTime(); chunkStart <= to.getTime(); chunkStart += CHUNK_DAYS * DAY) {
      const chunkEnd = Math.min(to.getTime(), chunkStart + CHUNK_DAYS * DAY - 1000);
      const rows = await biotime.listAll<BtTransaction>(ENDPOINTS.transactions, {
        start_time: localDateTime(new Date(chunkStart)),
        end_time: localDateTime(new Date(chunkEnd)),
      });
      fetched += rows.length;
      newPunchIds.push(...(await this.exclusivePunchWrite(() => punchesRepo.insertNew(rows, runId, dbNow()))));
    }
    return { fetched, created: newPunchIds.length, updated: 0, removed: 0, newPunchIds };
  }

  /**
   * Read punches straight from each Pull/Both device in Settings (zkteco-js), alongside BioTime.
   * Devices return their whole log, so only records from the cursor minus the look-back hours are kept
   * (the first-import days on the first run, which fires no webhooks). One unreachable device doesn't stop the
   * others; the run only fails if every device failed.
   */
  syncDevicePunches(trigger: SyncTrigger = 'manual', range?: { startDate: string; endDate: string }) {
    return this.runJob('device_punches', range ? 'range' : trigger, async (runId) => {
      if (!zk.enabled()) throw new Error('No devices are set up for reading. Add one in Settings > Devices (mode Pull or Both).');
      const now = new Date();
      const cursor = range ? null : await syncRunsRepo.punchCursor('device_punches');
      const initialImport = !range && !cursor;
      const from = range
        ? `${range.startDate} 00:00:00`
        : initialImport
          ? `${localDate(new Date(now.getTime() - (config.sync.initialDays - 1) * DAY))} 00:00:00`
          : localDateTime(new Date(new Date(fromDb(cursor!).replace(' ', 'T')).getTime() - config.sync.lookbackHours * HOUR));
      const to = range ? `${range.endDate} 23:59:59` : localDateTime(new Date(now.getTime() + DAY));

      let fetched = 0;
      const newPunchIds: number[] = [];
      const failures: string[] = [];
      for (const device of zk.devices()) {
        try {
          const { serial, punches } = await zk.readPunches(device);
          // "YYYY-MM-DD HH:mm:ss" strings compare correctly as text
          const inWindow = punches.filter((p) => p.punch_time >= from && p.punch_time <= to);
          fetched += inWindow.length;
          const ids = await this.exclusivePunchWrite(() => punchesRepo.insertFromDevice(inWindow, runId, dbNow()));
          newPunchIds.push(...ids);
          console.log(`[sync] Device ${device.ip} (${serial}): ${punches.length} in log, ${inWindow.length} in window, ${ids.length} new`);
        } catch (err) {
          failures.push((err as Error).message);
        }
      }
      if (failures.length === zk.devices().length) throw new Error(failures.join('; '));

      return {
        fetched,
        created: newPunchIds.length,
        updated: 0,
        removed: 0,
        rangeFrom: toDb(from),
        rangeTo: toDb(to),
        // A range re-import leaves the incremental cursor alone
        cursorAt: range ? null : toDb(localDateTime(now)),
        newPunchIds: initialImport ? [] : newPunchIds,
        error: failures.length ? `Some devices failed: ${failures.join('; ')}` : null,
      };
    });
  }

  /** Once a day: trim old sync history and old webhook deliveries. */
  private async pruneIfDue() {
    if (Date.now() - this.lastPruneAt < DAY) return;
    this.lastPruneAt = Date.now();
    try {
      const runs = await syncRunsRepo.pruneOlderThan(new Date(dbNow().getTime() - KEEP_RUNS_DAYS * DAY));
      const deliveries = await webhooksRepo.prune();
      if (runs.count || deliveries) console.log(`[sync] Pruned ${runs.count} old sync runs, ${deliveries} old webhook deliveries`);
    } catch (err) {
      console.warn('[sync] Prune failed:', (err as Error).message);
    }
  }
}

export const syncService = new SyncService();
