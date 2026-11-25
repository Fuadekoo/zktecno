import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export { Prisma } from '../generated/prisma/client.js';

/** Prisma 7 talks to PostgreSQL through the node-postgres (pg) driver adapter. */
const adapter = new PrismaPg({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: config.db.connectionLimit,
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
  if (/ECONNREFUSED|P1001|Can't reach|ETIMEDOUT/i.test(text)) {
    return `PostgreSQL is not reachable at ${config.db.host}:${config.db.port}. Is the PostgreSQL service running?`;
  }
  // 28P01 = wrong password, 28000 = no such role / not allowed by pg_hba.conf
  if (/28P01|28000|P1000|password authentication failed/i.test(text)) {
    return `PostgreSQL rejected the login ${where}. Check DB_USER / DB_PASSWORD in backend/.env.`;
  }
  if (/3D000|P1003|does not exist.*database|database .* does not exist/i.test(text)) {
    return `Database "${config.db.database}" does not exist. Run "npm run db:deploy" (it creates the database and tables).`;
  }
  if (/42P01|P2021|relation .* does not exist/i.test(text)) {
    return `Tables are missing in "${config.db.database}". Run "npm run db:deploy".`;
  }
  return (err as Error)?.message || String(err);
}

/** True for errors that mean "the database is unavailable" rather than a bug. */
export function isDbUnavailable(err: unknown) {
  return /ECONNREFUSED|ETIMEDOUT|ECONNRESET|28P01|28000|3D000|57P01|P1001|P1000|P1003|P1017|Connection terminated|timeout exceeded when trying to connect/i.test(
    errorText(err),
  );
}
