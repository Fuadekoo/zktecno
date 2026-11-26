/**
 * Direct device access with zkteco-js (TCP 4370).
 * Used alongside BioTime: the device keeps pushing to BioTime over ADMS while we read its log here.
 */
import Zkteco from 'zkteco-js';
import { config, type ZkDeviceConfig } from '../config.js';
import { localDateTime } from '../utils/http.js';

/** Enough to reach a device; per-device timeout and chunk size are optional. */
export interface ZkDeviceAddress {
  ip: string;
  port: number;
  timeoutMs?: number;
  chunkSize?: number | null;
}

/** A punch as read from a device, in the same shape the rest of the app uses. */
export interface ZkPunch {
  emp_code: string;
  /** Local wall-clock "YYYY-MM-DD HH:mm:ss" */
  punch_time: string;
  punch_state: string;
  verify_type: number;
  terminal_sn: string;
  work_code?: string | null;
}

/** A user enrolled on a device. */
export interface ZkUser {
  emp_code: string;
  name: string | null;
  card_no: string | null;
}

export interface ZkDeviceStatus {
  ip: string;
  port: number;
  online: boolean;
  connection: 'tcp' | 'udp' | null;
  serial_number: string | null;
  device_name: string | null;
  firmware: string | null;
  device_time: string | null;
  user_count: number | null;
  log_count: number | null;
  log_capacity: number | null;
  latency_ms: number;
  error: string | null;
}

/** zkteco-js throws plain ZkError objects (often nested), not Error instances. Turn them into a readable Error. */
export function zkErrorMessage(err: unknown): string {
  let e: any = err;
  let command: string | undefined;
  for (let i = 0; i < 5 && e && typeof e === 'object' && 'err' in e && !(e instanceof Error); i++) {
    command ??= e.command || undefined;
    e = e.err;
  }
  const code = e?.code as string | undefined;
  const text =
    code === 'ECONNREFUSED'
      ? 'connection refused (is the IP/port right, and is the device on?)'
      : code === 'ECONNRESET'
        ? 'connection reset (another program may be connected to the device)'
        : code === 'ETIMEDOUT' || code === 'EHOSTUNREACH'
          ? 'device did not answer (check the IP and network)'
          : e?.message || String(e);
  return command ? `${command}: ${text}` : text;
}

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Optional reads (some only exist over TCP, some firmwares don't answer them). */
async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const clean = (s: string | null | undefined) => (s ? s.replace(/\0/g, '').trim() || null : null);

const timeoutOf = (d: ZkDeviceAddress) => Math.max(1000, d.timeoutMs ?? config.zk.timeoutMs);

/** Connect, run `fn`, always disconnect. Each call opens its own connection. */
async function withDevice<T>(d: ZkDeviceAddress, fn: (dev: Zkteco) => Promise<T>, deadlineMs: number): Promise<T> {
  const timeoutMs = timeoutOf(d);
  const dev = new Zkteco(d.ip, d.port, timeoutMs, undefined, d.chunkSize ?? undefined);
  const label = `${d.ip}:${d.port}`;
  try {
    // The library's socket timeout doesn't abort a hanging connect, so enforce our own.
    await withDeadline(dev.createSocket(), timeoutMs, `Connecting to ${label}`);
    return await withDeadline(fn(dev), deadlineMs, `Reading ${label}`);
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : zkErrorMessage(err)}`);
  } finally {
    if (dev.connectionType) await withDeadline(dev.disconnect(), 3000, 'disconnect').catch(() => {});
  }
}

/** Protocol command and reply codes used for writing users. */
const CMD_USER_WRQ = 8;
const CMD_DELETE_USER = 18;
const CMD_REFRESHDATA = 1013;
const CMD_ACK_OK = 2000;

/** A person to write to a device. */
export interface ZkUserWrite {
  emp_code: string;
  name: string;
  password?: string | null;
  /** 0 employee, 2 enroller, 6 administrator, 14 super administrator */
  role?: number;
  card_no?: string | null;
}

/** Pad or cut a string to exactly `size` bytes (NUL padded). */
function fixed(value: string, size: number) {
  const b = Buffer.alloc(size);
  b.write(value, 0, size, 'utf8');
  return b;
}

async function expectAck(reply: Buffer, what: string) {
  const code = reply?.length >= 2 ? reply.readUInt16LE(0) : -1;
  if (code !== CMD_ACK_OK) throw new Error(`${what}: the device refused (reply code ${code})`);
}

/**
 * The 72-byte user record of TFT/face devices:
 * uid u16 | role u8 | password 8 | name 24 | card u32 | pad 1 | group 7 | pad 1 | user id 24
 * (zkteco-js's own setUser writes the card as 16 bits and caps the user id at 9 characters.)
 */
function userRecord(uid: number, u: ZkUserWrite) {
  const card = /^\d{1,10}$/.test(u.card_no ?? '') ? Math.min(Number(u.card_no), 0xffffffff) : 0;
  const b = Buffer.alloc(72);
  b.writeUInt16LE(uid, 0);
  b.writeUInt8((u.role ?? 0) & 0xff, 2);
  fixed(u.password ?? '', 8).copy(b, 3);
  fixed(u.name, 24).copy(b, 11);
  b.writeUInt32LE(card, 35);
  fixed('1', 7).copy(b, 40);
  fixed(u.emp_code, 24).copy(b, 48);
  return b;
}

export const zk = {
  devices: (): ZkDeviceConfig[] => config.zk.devices,
  enabled: () => config.zk.devices.length > 0,

  /**
   * Read the whole attendance log of one device (the protocol has no date filter).
   * Big logs take a while, so the read deadline is generous.
   */
  readPunches(d: ZkDeviceAddress) {
    return withDevice(
      d,
      async (dev) => {
        const serial = clean(await optional(() => dev.getSerialNumber())) ?? `${d.ip}:${d.port}`;
        const { data } = await dev.getAttendances();
        const punches: ZkPunch[] = [];
        for (const r of data ?? []) {
          const when = new Date(r.record_time);
          const code = clean(r.user_id);
          if (!code || Number.isNaN(when.getTime())) continue;
          punches.push({
            emp_code: code,
            punch_time: localDateTime(when),
            punch_state: String(r.state),
            verify_type: r.type,
            terminal_sn: serial,
          });
        }
        return { serial, punches };
      },
      Math.max(120_000, timeoutOf(d) * 12),
    );
  },

  /** The users enrolled on one device (user ID, name, card number). */
  readUsers(d: ZkDeviceAddress) {
    return withDevice(
      d,
      async (dev) => {
        const { data } = await dev.getUsers();
        const users: ZkUser[] = [];
        for (const u of data ?? []) {
          const code = clean(u.userId);
          if (!code) continue;
          users.push({ emp_code: code, name: clean(u.name), card_no: u.cardno ? String(u.cardno) : null });
        }
        return users;
      },
      Math.max(60_000, timeoutOf(d) * 6),
    );
  },

  /**
   * Add or update one user on a device, matched by user ID (emp_code). An existing user keeps its
   * internal slot (uid), so its fingerprints and face stay attached; a new user gets the next free slot.
   */
  upsertUser(d: ZkDeviceAddress, u: ZkUserWrite) {
    return withDevice(
      d,
      async (dev) => {
        const { data } = await dev.getUsers();
        const existing = (data ?? []).find((x) => clean(x.userId) === u.emp_code);
        const uid = existing?.uid ?? Math.max(0, ...(data ?? []).map((x) => x.uid)) + 1;
        if (uid > 0xffff) throw new Error('The device has no free user slots');
        await expectAck(await dev.executeCmd(CMD_USER_WRQ, userRecord(uid, u)), 'Writing the user');
        await dev.executeCmd(CMD_REFRESHDATA).catch(() => {});
        return { uid, created: !existing };
      },
      Math.max(60_000, timeoutOf(d) * 6),
    );
  },

  /** Remove one user (and their fingerprints/face) from a device. Not on the device = nothing to do. */
  deleteUser(d: ZkDeviceAddress, empCode: string) {
    return withDevice(
      d,
      async (dev) => {
        const { data } = await dev.getUsers();
        const existing = (data ?? []).find((x) => clean(x.userId) === empCode);
        if (!existing) return { deleted: false };
        const buf = Buffer.alloc(2);
        buf.writeUInt16LE(existing.uid, 0);
        await expectAck(await dev.executeCmd(CMD_DELETE_USER, buf), 'Deleting the user');
        await dev.executeCmd(CMD_REFRESHDATA).catch(() => {});
        return { deleted: true };
      },
      Math.max(60_000, timeoutOf(d) * 6),
    );
  },

  /** Live status of one device. Never throws: failures come back as `online: false` with an error. */
  async status(d: ZkDeviceAddress): Promise<ZkDeviceStatus> {
    const started = Date.now();
    const base = { ip: d.ip, port: d.port, serial_number: null, device_name: null, firmware: null, device_time: null, user_count: null, log_count: null, log_capacity: null };
    try {
      return await withDevice(
        d,
        async (dev) => {
          const info = await optional(() => dev.getInfo());
          const time = await optional(() => dev.getTime());
          return {
            ...base,
            online: true,
            connection: dev.connectionType,
            serial_number: clean(await optional(() => dev.getSerialNumber())),
            device_name: clean(await optional(() => dev.getDeviceName())),
            firmware: clean(await optional(() => dev.getFirmware())),
            device_time: time instanceof Date && !Number.isNaN(time.getTime()) ? localDateTime(time) : null,
            user_count: info?.userCounts ?? null,
            log_count: info?.logCounts ?? null,
            log_capacity: info?.logCapacity ?? null,
            latency_ms: Date.now() - started,
            error: null,
          };
        },
        timeoutOf(d) * 3,
      );
    } catch (err) {
      return { ...base, online: false, connection: null, latency_ms: Date.now() - started, error: (err as Error).message };
    }
  },
};
