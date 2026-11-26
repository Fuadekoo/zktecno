import os from 'node:os';
import { adms } from './adms/server.js';
import { createApp } from './app.js';
import { biotime } from './biotime/client.js';
import { config, warnAboutUnsafeConfig } from './config.js';
import { connectDatabase, describeDbError, disconnectDatabase } from './db/prisma.js';
import { syncRunsRepo } from './repositories/syncRuns.js';
import { authService } from './services/auth.service.js';
import { settingsService } from './services/settings.service.js';
import { syncService } from './services/sync.service.js';
import { webhookService } from './services/webhook.service.js';

async function main() {
  warnAboutUnsafeConfig();

  // 1. Database (tables are created by `prisma migrate deploy`, which `npm run dev/start` runs first)
  try {
    await connectDatabase();
    await syncRunsRepo.closeInterrupted();
    await authService.seedAdminIfEmpty();
    // Devices, BioTime, ADMS and sync settings live in the database (Settings page)
    await settingsService.load();
  } catch (err) {
    console.error(`[db] ${describeDbError(err)}`);
    process.exit(1);
  }
  console.log(`[db] Connected to PostgreSQL ${config.db.host}:${config.db.port}/${config.db.database} (Prisma)`);

  // 2. HTTP API
  const server = createApp().listen(config.port, config.host, () => {
    console.log(`[server] API listening on http://localhost:${config.port}/api`);
    if (config.host === '0.0.0.0') {
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => i!.address);
      for (const ip of ips) console.log(`[server] On your network: dashboard http://${ip}:3000  ·  API http://${ip}:${config.port}/api`);
    }
    if (config.biotime.enabled) console.log(`[server] BioTime: ${config.biotime.baseUrl} (auth: ${config.biotime.authType}, user: ${config.biotime.username})`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `[server] Port ${config.port} is already in use. Stop the other process or change PORT.` : err);
    process.exit(1);
  });

  // 3. BioTime check, background sync, webhook delivery worker
  if (config.biotime.enabled) biotime
    .ping()
    .then(({ latencyMs }) => console.log(`[biotime] Connected OK (${latencyMs} ms)`))
    .catch((err: Error) => console.warn(`[biotime] Not connected yet: ${err.message}`));
  syncService.start();
  webhookService.start();
  adms.start();

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    syncService.stop();
    webhookService.stop();
    void adms.stop();
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
