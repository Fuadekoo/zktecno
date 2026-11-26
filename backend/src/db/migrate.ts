/**
 * Applies prisma/migrations/<name>/migration.sql at startup, without the Prisma CLI.
 * Used by the desktop app, where shipping the CLI and its engines isn't worth it.
 *
 * Uses Prisma's own `_prisma_migrations` table (same columns, same sha256 checksum), so the database
 * stays compatible with `prisma migrate deploy` / `prisma migrate status` in development.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';

export async function runMigrations(dir: string) {
  if (!fs.existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();

  const client = new pg.Client({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const rows = (await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
    )).rows;
    const failed = rows.find((r) => !r.finished_at && !r.rolled_back_at);
    if (failed) {
      throw new Error(`Migration "${failed.migration_name}" failed earlier and was never finished. Fix the database, then delete its row from _prisma_migrations.`);
    }
    const applied = new Set(rows.filter((r) => r.finished_at).map((r) => r.migration_name));

    let count = 0;
    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const id = randomUUID();
      await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())', [id, checksum, name]);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        await client.query('UPDATE "_prisma_migrations" SET logs = $2, rolled_back_at = now() WHERE id = $1', [id, String((err as Error).message)]);
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
      await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
      console.log(`[db] Applied migration ${name}`);
      count++;
    }
    if (!count) console.log(`[db] Database is up to date (${names.length} migrations)`);
  } finally {
    await client.end();
  }
}
