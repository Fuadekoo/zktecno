import type { Request, Response } from 'express';
import { config } from '../config.js';
import { describeDbError, prisma } from '../db/prisma.js';
import { syncService } from '../services/sync.service.js';

const DB_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

async function checkDatabase() {
  const started = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: describeDbError(err) };
  }
}

export const healthController = {
  /** Liveness: the process is up and serving HTTP. No dependencies, always fast (the desktop app polls this on startup). */
  live(_req: Request, res: Response) {
    res.json({ ok: true, time: new Date().toISOString() });
  },

  /**
   * Readiness: can the API actually serve requests? Checks MySQL.
   * 200 when healthy, 503 when a required dependency is down (for load balancers / uptime monitors).
   * Public, so it reports status only, never hosts or credentials.
   */
  async ready(_req: Request, res: Response) {
    const database = await checkDatabase();
    const ok = database.ok;
    const mem = process.memoryUsage();
    res.status(ok ? 200 : 503).json({
      ok,
      status: ok ? 'healthy' : 'unhealthy',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
      checks: {
        database,
        sync: { enabled: config.sync.enabled, running: syncService.isRunning() },
        adms: { enabled: config.adms.enabled },
        biotime: { enabled: config.biotime.enabled },
      },
    });
  },
};
