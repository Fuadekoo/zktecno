/**
 * Settings stored in PostgreSQL and edited on the Settings page (instead of backend/.env).
 *
 * - `app_settings` holds the BioTime, ADMS and sync sections as JSON.
 * - `zk_devices` holds the attendance devices.
 *
 * On the very first start both are filled from .env, so an existing setup keeps working. After that the
 * database wins and the matching .env lines are ignored. Values are copied into `config` so the rest of
 * the code reads them as before; saving applies them at once (no restart).
 *
 * .env still holds what is needed before the database is open: DB_*, PORT, HOST, APP_JWT_SECRET.
 */
import os from 'node:os';
import { adms } from '../adms/server.js';
import { biotime } from '../biotime/client.js';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { dbNow } from '../db/time.js';
import { HttpError } from '../utils/http.js';
import { zkDevicesRepo } from '../repositories/zkDevices.js';
import { syncService } from './sync.service.js';

export interface BioTimeSettings {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  auth_type: 'jwt' | 'token';
  timeout_ms: number;
}

export interface AdmsSettings {
  enabled: boolean;
  port: number;
  forward: boolean;
  /** Empty = the BioTime address */
  forward_url: string;
  forward_timeout_ms: number;
  /** Save pushes from any device, not only the ones listed under Devices (handy for testing) */
  accept_any: boolean;
}

export interface SyncSettings {
  enabled: boolean;
  interval_seconds: number;
  employees_minutes: number;
  initial_days: number;
  lookback_hours: number;
  /** Default network timeout for new devices */
  device_timeout_ms: number;
}

export interface AppSettings {
  biotime: BioTimeSettings;
  adms: AdmsSettings;
  sync: SyncSettings;
}

export type SettingsSection = keyof AppSettings;
export const SECTIONS: SettingsSection[] = ['biotime', 'adms', 'sync'];

/** The values .env produced at startup: used once to fill an empty database, and as defaults. */
const fromEnv: AppSettings = {
  biotime: {
    enabled: config.biotime.enabled,
    url: config.biotime.baseUrl,
    username: config.biotime.username,
    password: config.biotime.password,
    auth_type: config.biotime.authType,
    timeout_ms: config.biotime.timeoutMs,
  },
  adms: {
    enabled: config.adms.enabled,
    port: config.adms.port,
    forward: config.adms.forward,
    forward_url: config.adms.forwardUrl === config.biotime.baseUrl ? '' : config.adms.forwardUrl,
    forward_timeout_ms: config.adms.forwardTimeoutMs,
    accept_any: config.adms.allowedSn.includes('*'),
  },
  sync: {
    enabled: config.sync.enabled,
    interval_seconds: config.sync.intervalSeconds,
    employees_minutes: config.sync.employeesMinutes,
    initial_days: config.sync.initialDays,
    lookback_hours: config.sync.lookbackHours,
    device_timeout_ms: config.zk.timeoutMs,
  },
};
const envDevices = [...config.zk.devices];
const envSerials = config.adms.allowedSn.filter((s) => s !== '*');

let current: AppSettings = structuredClone(fromEnv);

function apply(s: AppSettings) {
  const bt = config.biotime;
  const credentialsChanged = bt.baseUrl !== s.biotime.url || bt.username !== s.biotime.username || bt.password !== s.biotime.password || bt.authType !== s.biotime.auth_type;
  Object.assign(bt, {
    enabled: s.biotime.enabled,
    baseUrl: s.biotime.url.replace(/\/+$/, ''),
    username: s.biotime.username,
    password: s.biotime.password,
    authType: s.biotime.auth_type,
    timeoutMs: s.biotime.timeout_ms,
  });
  if (credentialsChanged) biotime.resetToken();

  Object.assign(config.adms, {
    enabled: s.adms.enabled,
    port: s.adms.port,
    forward: s.adms.forward,
    forwardUrl: (s.adms.forward_url || s.biotime.url).replace(/\/+$/, ''),
    forwardTimeoutMs: Math.max(1000, s.adms.forward_timeout_ms),
  });

  Object.assign(config.sync, {
    enabled: s.sync.enabled,
    intervalSeconds: Math.max(60, s.sync.interval_seconds),
    employeesMinutes: Math.max(1, s.sync.employees_minutes),
    initialDays: Math.max(1, s.sync.initial_days),
    lookbackHours: Math.max(1, s.sync.lookback_hours),
  });
  config.zk.timeoutMs = Math.max(1000, s.sync.device_timeout_ms);
}

async function save(section: SettingsSection, value: object) {
  const updatedAt = dbNow();
  await prisma.appSetting.upsert({ where: { key: section }, create: { key: section, value, updatedAt }, update: { value, updatedAt } });
}

/** Fill empty tables from .env (first start only). */
async function seedIfEmpty() {
  const existing = new Set((await prisma.appSetting.findMany({ select: { key: true } })).map((r) => r.key));
  const missing = SECTIONS.filter((s) => !existing.has(s));
  for (const section of missing) await save(section, fromEnv[section]);

  if (!existing.has('devices_seeded')) {
    if ((await zkDevicesRepo.count()) === 0) {
      for (const d of envDevices) {
        await zkDevicesRepo.create({ name: `Device ${d.ip}`, mode: 'pull', ip: d.ip, port: d.port, serial_number: null, location: null, timeout_ms: d.timeoutMs, chunk_size: null, enabled: true });
      }
      for (const sn of envSerials) {
        await zkDevicesRepo.create({ name: `Device ${sn}`, mode: 'push', ip: null, port: 4370, serial_number: sn, location: null, timeout_ms: config.zk.timeoutMs, chunk_size: null, enabled: true });
      }
    }
    await save('devices_seeded' as SettingsSection, { at: new Date().toISOString() });
  }
  if (missing.length) console.log(`[settings] First start: copied ${missing.join(', ')} settings and devices from .env into the database. From now on, change them on the Settings page.`);
}

export const settingsService = {
  /** Startup: seed if needed, then load everything into `config`. */
  async load() {
    await seedIfEmpty();
    const rows = await prisma.appSetting.findMany({ where: { key: { in: SECTIONS } } });
    const s = structuredClone(fromEnv);
    for (const r of rows) {
      const key = r.key as SettingsSection;
      // Stored values over defaults, so settings added in later versions get a sensible value
      (s as unknown as Record<string, object>)[key] = { ...fromEnv[key], ...(r.value as object) };
    }
    current = s;
    apply(current);
    await this.reloadDevices();
    console.log(`[settings] Loaded from database: ${config.zk.devices.length} device(s) read over the network, BioTime ${config.biotime.enabled ? 'on' : 'off'}, ADMS ${config.adms.enabled ? `on (port ${config.adms.port})` : 'off'}`);
  },

  /** Rebuild the device lists in `config` from zk_devices (after any device change). */
  async reloadDevices() {
    const rows = await zkDevicesRepo.list();
    const active = rows.filter((d) => d.enabled);
    config.zk.devices = active
      .filter((d) => d.mode !== 'push' && d.ip)
      .map((d) => ({ id: d.id, name: d.name, ip: d.ip!, port: d.port, timeoutMs: d.timeoutMs, chunkSize: d.chunkSize }));
    const serials = active.filter((d) => d.mode !== 'pull' && d.serialNumber).map((d) => d.serialNumber!);
    // Empty list (and accept_any off) = only devices BioTime knows, as before
    config.adms.allowedSn = current.adms.accept_any ? ['*'] : serials;
  },

  /** Settings for the page. The BioTime password is never sent back, only whether one is set. */
  get() {
    const { password, ...bt } = current.biotime;
    return { biotime: { ...bt, password: '', password_set: Boolean(password) }, adms: current.adms, sync: current.sync };
  },

  /** The full BioTime settings with `patch` applied (for "Test connection" before saving). */
  biotimeWith(patch: Partial<BioTimeSettings>): BioTimeSettings {
    const merged = { ...current.biotime, ...patch };
    if (!patch.password) merged.password = current.biotime.password;
    return merged;
  },

  /** Save one section and apply it right away. */
  async update<K extends SettingsSection>(section: K, patch: Partial<AppSettings[K]>) {
    if (!SECTIONS.includes(section)) throw new HttpError(404, 'Unknown settings section');
    const before = current[section];
    const next = { ...before, ...patch } as AppSettings[K];
    // An empty password field means "keep the current one"
    if (section === 'biotime' && !(patch as Partial<BioTimeSettings>).password) (next as BioTimeSettings).password = current.biotime.password;
    if (section === 'adms') {
      const a = next as AdmsSettings;
      if (a.port === config.port) throw new HttpError(400, `Port ${a.port} is the dashboard API port. Pick another one.`, { port: 'Already used by the API' });
    }

    await save(section, next);
    current = { ...current, [section]: next };
    apply(current);

    const changed = Object.keys(patch).filter((k) => (before as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]);
    if (section === 'adms') {
      await this.reloadDevices();
      const a = before as AdmsSettings;
      const n = next as AdmsSettings;
      if (a.enabled !== n.enabled || a.port !== n.port) await adms.restart();
    }
    // New intervals, or BioTime turned on/off: restart the timer (runs one cycle now)
    if (section === 'sync' || (section === 'biotime' && changed.includes('enabled'))) syncService.restart();
    return changed.filter((k) => k !== 'password').concat(changed.includes('password') ? ['password (changed)'] : []);
  },

  /** What the device needs to push here: this PC's network addresses and the ADMS port. */
  network() {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address);
    return { server_ips: ips, adms_port: config.adms.port, adms_enabled: config.adms.enabled, adms_listening: adms.listening(), api_port: config.port };
  },
};
