/**
 * One-time copy of all data from the old PostgreSQL database into MySQL.
 *
 *   npm run db:copy-from-postgres            copy into an empty MySQL database
 *   npm run db:copy-from-postgres -- --force  empty the MySQL tables first, then copy
 *
 * Source: PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE in backend/.env.
 * Target: the normal DB_* settings (MySQL). The MySQL tables are created first if needed.
 *
 * Times are copied as their exact wall-clock text, so "08:30:00" stays "08:30:00". Ids are kept, so
 * links between tables (punches → sync runs, deliveries → webhooks, …) stay intact.
 * PostgreSQL is only read, never changed: it remains as a backup.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import pg from 'pg';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';

const force = process.argv.includes('--force');
const BATCH = 500;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '..', '..', 'prisma', 'migrations');

const pgConfig = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'zkteco_attendance',
};

const q = (name: string) => `\`${name.replace(/`/g, '')}\``;

async function main() {
  console.log(`From PostgreSQL ${pgConfig.user}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);
  console.log(`To   MySQL      ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}\n`);

  // 1. MySQL database and tables
  await runMigrations(MIGRATIONS);

  const source = new pg.Client(pgConfig);
  await source.connect();
  const target = await mariadb.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    allowPublicKeyRetrieval: true,
  });

  try {
    // 2. Tables that exist on both sides
    const mysqlTables: string[] = (
      await target.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'")
    ).map((r: { t: string }) => r.t);
    const pgTables = new Set(
      (await source.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map(
        (r) => r.t as string,
      ),
    );
    const tables = mysqlTables.filter((t) => pgTables.has(t)).sort();
    const missing = mysqlTables.filter((t) => !pgTables.has(t));
    if (missing.length) console.log(`Not in PostgreSQL (left empty): ${missing.join(', ')}`);

    // 3. Refuse to mix data unless --force
    const filled: string[] = [];
    for (const t of tables) {
      const [{ n }] = await target.query(`SELECT COUNT(*) AS n FROM ${q(t)}`);
      if (Number(n) > 0) filled.push(`${t} (${n})`);
    }
    if (filled.length && !force) {
      throw new Error(`MySQL already has data in: ${filled.join(', ')}.\nRun again with --force to empty those tables and copy everything from PostgreSQL.`);
    }

    await target.query('SET FOREIGN_KEY_CHECKS = 0');
    let total = 0;
    for (const table of tables) {
      if (force) await target.query(`DELETE FROM ${q(table)}`);

      // Columns present in both, with a PostgreSQL expression that gives MySQL-ready values
      const mysqlCols: string[] = (
        await target.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [table])
      ).map((r: { c: string }) => r.c);
      const pgCols = new Map(
        (
          await source.query('SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['public', table])
        ).rows.map((r) => [r.c as string, r.t as string]),
      );
      const cols = mysqlCols.filter((c) => pgCols.has(c));
      const select = cols
        .map((c) => {
          const type = pgCols.get(c)!;
          const col = `"${c}"`;
          if (type.startsWith('timestamp')) return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS') AS ${col}`; // exact wall-clock text
          if (type === 'date') return `to_char(${col}, 'YYYY-MM-DD') AS ${col}`;
          if (type === 'json' || type === 'jsonb' || type === 'USER-DEFINED') return `${col}::text AS ${col}`; // JSON text, enum names
          if (type === 'boolean') return `CASE WHEN ${col} IS NULL THEN NULL WHEN ${col} THEN 1 ELSE 0 END AS ${col}`;
          return col;
        })
        .join(', ');

      const insert = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const cursorSql = `SELECT ${select} FROM "${table}" ORDER BY 1`;
      let copied = 0;
      for (let offset = 0; ; offset += BATCH) {
        const { rows } = await source.query(`${cursorSql} LIMIT ${BATCH} OFFSET ${offset}`);
        if (!rows.length) break;
        await target.batch(
          insert,
          rows.map((r) => cols.map((c) => r[c])),
        );
        copied += rows.length;
      }
      total += copied;
      console.log(`  ${table.padEnd(22)} ${String(copied).padStart(7)} rows`);
    }
    await target.query('SET FOREIGN_KEY_CHECKS = 1');

    // 4. Check: same number of rows on both sides
    let ok = true;
    for (const table of tables) {
      const a = Number((await source.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n);
      const [{ n }] = await target.query(`SELECT COUNT(*) AS n FROM ${q(table)}`);
      if (a !== Number(n)) {
        ok = false;
        console.error(`  MISMATCH ${table}: PostgreSQL ${a}, MySQL ${n}`);
      }
    }
    console.log(`\n${ok ? 'Done' : 'Finished with differences'}: ${total} rows copied into MySQL "${config.db.database}". PostgreSQL was not changed.`);
    if (!ok) process.exitCode = 1;
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nCopy failed: ${(err as Error).message}`);
  process.exit(1);
});
