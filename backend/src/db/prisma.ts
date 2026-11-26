import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export { Prisma } from '../generated/prisma/client.js';

/**
 * Prisma 7 talks to MySQL through the MariaDB driver adapter (the mariadb package works with MySQL too).
 * DATETIME values are written and read as plain wall-clock text, matching src/db/time.ts.
 */
const adapter = new PrismaMariaDb({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  // MySQL 8 default login (caching_sha2_password) over a plain connection needs the server's RSA key
  allowPublicKeyRetrieval: true,
  connectTimeout: 10_000,
});

export const prisma = new PrismaClient({
  adapter,
  log: config.isProduction ? ['error'] : ['error', 'warn'],
});

export async function connectDatabase() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

function errorText(err: unknown) {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  return `${e.code ?? ''} ${e.cause?.code ?? ''} ${e.message ?? ''} ${e.cause?.message ?? ''}`;
}

/** Turn a connection/driver error into a message a person can act on. */
export function describeDbError(err: unknown): string {
  const text = errorText(err);
  const where = `${config.db.user}@${config.db.host}:${config.db.port}`;
  if (/ECONNREFUSED|P1001|Can't reach|ETIMEDOUT|ER_GET_CONNECTION_TIMEOUT|connect ETIMEDOUT/i.test(text)) {
    return `MySQL is not reachable at ${config.db.host}:${config.db.port}. Is the MySQL service running?`;
  }
  // 1045 = wrong user/password
  if (/ER_ACCESS_DENIED_ERROR|1045|P1000|Access denied for user/i.test(text)) {
    return `MySQL rejected the login ${where}. Check DB_USER / DB_PASSWORD in backend/.env.`;
  }
  // 1049 = unknown database
  if (/ER_BAD_DB_ERROR|1049|P1003|Unknown database/i.test(text)) {
    return `Database "${config.db.database}" does not exist. Run "npm run db:deploy" (it creates the database and tables).`;
  }
  // 1146 = table doesn't exist
  if (/ER_NO_SUCH_TABLE|1146|P2021|Table .* doesn't exist/i.test(text)) {
    return `Tables are missing in "${config.db.database}". Run "npm run db:deploy".`;
  }
  return (err as Error)?.message || String(err);
}

/** True for errors that mean "the database is unavailable" rather than a bug. */
export function isDbUnavailable(err: unknown) {
  return /ECONNREFUSED|ETIMEDOUT|ECONNRESET|ER_ACCESS_DENIED_ERROR|ER_BAD_DB_ERROR|ER_GET_CONNECTION_TIMEOUT|ER_CON_COUNT_ERROR|PROTOCOL_CONNECTION_LOST|P1001|P1000|P1003|P1017|pool timeout|Connection terminated/i.test(
    errorText(err),
  );
}
