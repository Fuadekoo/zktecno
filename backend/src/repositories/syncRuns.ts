import { prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { SyncJob, SyncRun, SyncTrigger } from '../generated/prisma/client.js';

export type { SyncJob, SyncTrigger };

export const SYNC_JOBS: SyncJob[] = ['punches', 'employees', 'devices', 'device_punches'];

export function runToJson(r: SyncRun) {
  return {
    id: r.id,
    job: r.job,
    trigger: r.trigger,
    status: r.status,
    started_at: fromDb(r.startedAt),
    finished_at: fromDb(r.finishedAt),
    duration_ms: r.durationMs,
    fetched: r.fetched,
    created: r.created,
    updated: r.updated,
    removed: r.removed,
    range_from: fromDb(r.rangeFrom),
    range_to: fromDb(r.rangeTo),
    webhooks_queued: r.webhooksQueued,
    error: r.error,
  };
}

export const syncRunsRepo = {
  start: (job: SyncJob, trigger: SyncTrigger) => prisma.syncRun.create({ data: { job, trigger, startedAt: dbNow() } }),

  finish(
    id: number,
    startedMs: number,
    result: { fetched: number; created: number; updated: number; removed: number; rangeFrom?: Date | null; rangeTo?: Date | null; cursorAt?: Date | null; error?: string | null },
  ) {
    return prisma.syncRun.update({
      where: { id },
      // A successful run can still carry a warning (e.g. one of several devices was unreachable)
      data: { ...result, error: result.error?.slice(0, 5000) ?? null, status: 'success', finishedAt: dbNow(), durationMs: Date.now() - startedMs },
    });
  },

  fail: (id: number, startedMs: number, error: string) =>
    prisma.syncRun.update({
      where: { id },
      data: { status: 'failed', finishedAt: dbNow(), durationMs: Date.now() - startedMs, error: error.slice(0, 5000) },
    }),

  setWebhooksQueued: (id: number, n: number) => prisma.syncRun.update({ where: { id }, data: { webhooksQueued: n } }),

  /** Where the next incremental punch sync (BioTime or direct-device) continues from. */
  async punchCursor(job: 'punches' | 'device_punches' = 'punches'): Promise<Date | null> {
    const run = await prisma.syncRun.findFirst({
      where: { job, status: 'success', cursorAt: { not: null } },
      orderBy: { id: 'desc' },
      select: { cursorAt: true },
    });
    return run?.cursorAt ?? null;
  },

  /** A crash mid-sync leaves runs marked "running": close them on startup. */
  closeInterrupted: () =>
    prisma.syncRun.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', finishedAt: dbNow(), error: 'Interrupted (the server stopped during this sync)' },
    }),

  /** Latest run, latest success and run count per job (for the status page). */
  async summary() {
    return Promise.all(
      SYNC_JOBS.map(async (job) => {
        const [last, lastSuccess, total] = await Promise.all([
          prisma.syncRun.findFirst({ where: { job }, orderBy: { id: 'desc' } }),
          prisma.syncRun.findFirst({ where: { job, status: 'success' }, orderBy: { id: 'desc' } }),
          prisma.syncRun.count({ where: { job } }),
        ]);
        return {
          job,
          is_running: last?.status === 'running',
          last_started_at: fromDb(last?.startedAt),
          last_finished_at: fromDb(last?.finishedAt),
          last_success_at: fromDb(lastSuccess?.finishedAt),
          last_error: last?.error ?? null,
          last_count: last?.fetched ?? 0,
          last_created: last?.created ?? 0,
          total_runs: total,
        };
      }),
    );
  },

  async page(limit: number, offset: number, job?: SyncJob) {
    const where = job ? { job } : {};
    const [rows, count] = await Promise.all([
      prisma.syncRun.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset }),
      prisma.syncRun.count({ where }),
    ]);
    return { count, data: rows.map(runToJson) };
  },

  /** Keep history bounded. */
  pruneOlderThan: (cutoff: Date) => prisma.syncRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: 'running' } } }),
};
