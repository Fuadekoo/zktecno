import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/** Build the PostgreSQL URL from the same DB_* variables the server uses (password safely encoded). */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const e = process.env;
  const user = encodeURIComponent(e.DB_USER || 'postgres');
  const pass = e.DB_PASSWORD ? `:${encodeURIComponent(e.DB_PASSWORD)}` : '';
  return `postgresql://${user}${pass}@${e.DB_HOST || '127.0.0.1'}:${e.DB_PORT || '5432'}/${e.DB_NAME || 'zkteco_attendance'}?schema=public`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // `npx prisma db seed` and `prisma migrate reset` run the demo-data seed
  migrations: { path: 'prisma/migrations', seed: 'tsx src/db/seed.ts' },
  datasource: { url: databaseUrl() },
});
