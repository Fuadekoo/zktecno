/**
 * Applies prisma/migrations/<name>/migration.sql at startup, without the Prisma CLI.
 * Used by the desktop app, where shipping the CLI and its engines isn't worth it.
 *
 * Uses Prisma's own `_prisma_migrations` table (same columns, same sha256 checksum), so the database
 * stays compatible with `prisma migrate deploy` / `prisma migrate status` in development.
 * Creates the database first if it doesn't exist (as `prisma migrate deploy` does).
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { config } from '../config.js';

export async function runMigrations(dir: string) {
  if (!fs.existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();

  const db = config.db.database;
  if (!/^[A-Za-z0-9_]+$/.test(db)) throw new Error('DB_NAME may only contain letters, numbers and underscores');

  const conn = await mariadb.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    allowPublicKeyRetrieval: true,
    multipleStatements: true, // a migration file holds many statements
    connectTimeout: 10_000,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${db}\``);
    await conn.query(`CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`checksum\` VARCHAR(64) NOT NULL,
      \`finished_at\` DATETIME(3) NULL,
      \`migration_name\` VARCHAR(255) NOT NULL,
      \`logs\` TEXT NULL,
      \`rolled_back_at\` DATETIME(3) NULL,
      \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`applied_steps_count\` INTEGER UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    const rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[] = await conn.query(
      'SELECT migration_name, finished_at, rolled_back_at FROM `_prisma_migrations`',
    );
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
      await conn.query('INSERT INTO `_prisma_migrations` (id, checksum, migration_name, started_at) VALUES (?, ?, ?, NOW(3))', [id, checksum, name]);
      // MySQL commits table changes immediately (no transactional DDL), like `prisma migrate deploy`
      try {
        await conn.query(sql);
      } catch (err) {
        await conn.query('UPDATE `_prisma_migrations` SET logs = ?, rolled_back_at = NOW(3) WHERE id = ?', [String((err as Error).message), id]);
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
      await conn.query('UPDATE `_prisma_migrations` SET finished_at = NOW(3), applied_steps_count = 1 WHERE id = ?', [id]);
      console.log(`[db] Applied migration ${name}`);
      count++;
    }
    if (!count) console.log(`[db] Database is up to date (${names.length} migration${names.length === 1 ? '' : 's'})`);
  } finally {
    await conn.end();
  }
}
