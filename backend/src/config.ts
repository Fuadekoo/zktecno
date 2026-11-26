import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: `"${v}" is not a number` });
        return z.NEVER;
      }
      return n;
    });

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: num(4000),
  // 0.0.0.0 = reachable from other devices on the network; 127.0.0.1 = this computer only
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // false = no BioTime server: sync uses only ZK_DEVICES and ADMS push
  BIOTIME_ENABLED: bool(true),
  BIOTIME_URL: z.string().url().default('http://127.0.0.1:8090'),
  BIOTIME_USERNAME: z.string().default('admin'),
  BIOTIME_PASSWORD: z.string().default('admin'),
  BIOTIME_AUTH_TYPE: z
    .string()
    .default('jwt')
    .transform((v) => (v.toLowerCase() === 'token' ? 'token' : 'jwt') as 'jwt' | 'token'),
  BIOTIME_TIMEOUT_MS: num(20000),

  // Devices read directly with zkteco-js (alongside BioTime). Comma-separated "ip" or "ip:port"; empty = off.
  ZK_DEVICES: z.string().default(''),
  ZK_TIMEOUT_MS: num(10000),

  // ADMS push: devices send punches to this server ("Cloud Server Setting" on the device).
  ADMS_ENABLED: bool(false),
  ADMS_PORT: num(8082),
  // Forward every device request to BioTime so it keeps working (the device's previous server address).
  ADMS_FORWARD: bool(true),
  ADMS_FORWARD_URL: z.string().default(''),
  ADMS_FORWARD_TIMEOUT_MS: num(15000),
  // Serial numbers whose punches are saved. Empty = devices BioTime knows (devices table).
  ADMS_ALLOWED_SN: z.string().default(''),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: num(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z
    .string()
    .default('zkteco_attendance')
    .refine((v) => /^[A-Za-z0-9_]+$/.test(v), 'DB_NAME may only contain letters, numbers and underscores'),
  DB_CONNECTION_LIMIT: num(10),

  SYNC_ENABLED: bool(true),
  SYNC_INTERVAL_SECONDS: num(3600),
  SYNC_INITIAL_DAYS: num(30),
  SYNC_LOOKBACK_HOURS: num(48),
  SYNC_EMPLOYEES_MINUTES: num(60),

  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('change-me-please'),
  APP_JWT_SECRET: z.string().default('dev-only-insecure-secret'),
  APP_SESSION_HOURS: num(12),

  // ---- Desktop app (Electron) / single-process mode ----
  // Folder with the exported dashboard (frontend/out). Set = the API also serves the dashboard on PORT.
  STATIC_DIR: z.string().default(""),
  // Apply prisma/migrations at startup without the Prisma CLI (the desktop app sets this)
  RUN_MIGRATIONS: bool(false),
  MIGRATIONS_DIR: z.string().default(""),
  // Session cookie "Secure" flag. Default: on in production. Off for plain http:// on a local network.
  COOKIE_SECURE: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Invalid environment variables:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
const env = parsed.data;

/** A device the server reads over the network (pull / both). */
export interface ZkDeviceConfig {
  /** zk_devices.id (0 for devices that only came from .env before the first start) */
  id: number;
  name: string;
  ip: string;
  port: number;
  timeoutMs: number;
  chunkSize: number | null;
}

function parseZkDevices(value: string) {
  const list: ZkDeviceConfig[] = [];
  for (const raw of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([^\s:]+)(?::(\d{1,5}))?$/.exec(raw);
    if (!m) {
      console.error(`[config] ZK_DEVICES: "${raw}" is not "ip" or "ip:port"`);
      process.exit(1);
    }
    list.push({ id: 0, name: m[1]!, ip: m[1]!, port: m[2] ? Number(m[2]) : 4370, timeoutMs: env.ZK_TIMEOUT_MS, chunkSize: null });
  }
  return list;
}

export const config = {
  port: env.PORT,
  host: env.HOST,
  isProduction: env.NODE_ENV === 'production',
  corsOrigin: env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),

  biotime: {
    enabled: env.BIOTIME_ENABLED,
    baseUrl: env.BIOTIME_URL.replace(/\/+$/, ''),
    username: env.BIOTIME_USERNAME,
    password: env.BIOTIME_PASSWORD,
    authType: env.BIOTIME_AUTH_TYPE,
    timeoutMs: env.BIOTIME_TIMEOUT_MS,
  },

  zk: {
    devices: parseZkDevices(env.ZK_DEVICES),
    timeoutMs: Math.max(1000, env.ZK_TIMEOUT_MS),
  },

  adms: {
    enabled: env.ADMS_ENABLED,
    port: env.ADMS_PORT,
    forward: env.ADMS_FORWARD,
    forwardUrl: (env.ADMS_FORWARD_URL || env.BIOTIME_URL).replace(/\/+$/, ''),
    forwardTimeoutMs: Math.max(1000, env.ADMS_FORWARD_TIMEOUT_MS),
    allowedSn: env.ADMS_ALLOWED_SN.split(',').map((s) => s.trim()).filter(Boolean),
  },

  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_CONNECTION_LIMIT,
  },

  sync: {
    enabled: env.SYNC_ENABLED,
    intervalSeconds: Math.max(60, env.SYNC_INTERVAL_SECONDS),
    initialDays: Math.max(1, env.SYNC_INITIAL_DAYS),
    lookbackHours: Math.max(1, env.SYNC_LOOKBACK_HOURS),
    employeesMinutes: Math.max(1, env.SYNC_EMPLOYEES_MINUTES),
  },

  app: {
    seedAdminUsername: env.ADMIN_USERNAME,
    seedAdminPassword: env.ADMIN_PASSWORD,
    jwtSecret: env.APP_JWT_SECRET,
    sessionHours: env.APP_SESSION_HOURS,
    cookieName: 'zk_session',
    cookieSecure: env.COOKIE_SECURE === undefined || env.COOKIE_SECURE === '' ? env.NODE_ENV === 'production' : ['1', 'true', 'yes', 'on'].includes(env.COOKIE_SECURE.toLowerCase()),
  },

  desktop: {
    staticDir: env.STATIC_DIR,
    runMigrations: env.RUN_MIGRATIONS,
    migrationsDir: env.MIGRATIONS_DIR,
  },
};

export function warnAboutUnsafeConfig() {
  const warnings: string[] = [];
  if (!process.env.APP_JWT_SECRET || process.env.APP_JWT_SECRET.startsWith('replace-with')) {
    warnings.push('APP_JWT_SECRET is not set. Set a long random value in .env.');
  }
  for (const w of warnings) console.warn(`[config] WARNING: ${w}`);
  if (config.isProduction && warnings.length) {
    throw new Error('Refusing to start in production with unsafe configuration (see warnings above).');
  }
}
