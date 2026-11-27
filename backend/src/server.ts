import os from 'node:os';
import { adms } from './adms/server.js';
import { createApp } from './app.js';
import { realtime } from './realtime.js';
import { biotime } from './biotime/client.js';
import { config, warnAboutUnsafeConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { connectDatabase, describeDbError, disconnectDatabase } from './db/prisma.js';
import { syncRunsRepo } from './repositories/syncRuns.js';
import { authService } from './services/auth.service.js';
import { deviceCommands } from './services/deviceCommands.service.js';
import { settingsService } from './services/settings.service.js';
import { syncService } from './services/sync.service.js';
import { webhookService } from './services/webhook.service.js';

async function main() {
  warnAboutUnsafeConfig();

  // 1. Database (tables are created by `prisma migrate deploy`, which `npm run dev/start` runs first)
  try {
    // Desktop app: apply migrations here (development uses `prisma migrate deploy` instead)
    if (config.desktop.runMigrations) await runMigrations(config.desktop.migrationsDir);
    await connectDatabase();
    await syncRunsRepo.closeInterrupted();
    await authService.seedAdminIfEmpty();
    // Devices, BioTime, ADMS and sync settings live in the database (Settings page)
    await settingsService.load();
  } catch (err) {
    console.error(`[db] ${describeDbError(err)}`);
    process.exit(1);
  }
  console.log(`[db] Connected to MySQL ${config.db.host}:${config.db.port}/${config.db.database} (Prisma)`);

  // 2. HTTP API
  const server = createApp().listen(config.port, config.host, () => {
    console.log(`[server] API listening on http://localhost:${config.port}/api`);
    if (config.desktop.staticDir) console.log(`[server] Dashboard on http://localhost:${config.port}/`);
    process.send?.({ type: 'ready', port: config.port });
    if (config.host === '0.0.0.0') {
      const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => i!.address);
      // The dashboard port: the API itself in desktop mode, else the port in CORS_ORIGIN (the frontend address)
      const corsPort = (() => { try { return new URL(config.corsOrigin[0] ?? "").port; } catch { return ""; } })();
      const dashPort = config.desktop.staticDir ? config.port : Number(corsPort) || 3000;
      for (const ip of ips) console.log(`[server] On your network: dashboard http://${ip}:${dashPort}  ·  API http://${ip}:${config.port}/api`);
    }
    if (config.biotime.enabled) console.log(`[server] BioTime: ${config.biotime.baseUrl} (auth: ${config.biotime.authType}, user: ${config.biotime.username})`);
  });
  // Live updates for the dashboard (Socket.IO on the same port)
  realtime.attach(server);
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
  deviceCommands.start();

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    syncService.stop();
    webhookService.stop();
    deviceCommands.stop();
    void adms.stop();
    realtime.close();
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Desktop app: Windows has no real SIGTERM for child processes, so it asks over the IPC channel
  process.on('message', (m: unknown) => {
    if ((m as { type?: string } | null)?.type === 'shutdown') shutdown('desktop app');
  });
  // ...and if the desktop app itself goes away (crash, killed), don't keep running on our own
  process.on('disconnect', () => shutdown('desktop app closed'));
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
