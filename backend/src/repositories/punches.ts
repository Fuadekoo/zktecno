import { punchStateLabel, verifyTypeLabel } from '../biotime/endpoints.js';
import type { BtTransaction } from '../biotime/types.js';
import { prisma, Prisma } from '../db/prisma.js';
import { fromDb, toDb } from '../db/time.js';
import type { ZkPunch } from '../zk/client.js';

export interface PunchFilters {
  empCode?: string;
  terminalSn?: string;
  departmentId?: number;
  search?: string;
  from?: string; // YYYY-MM-DD HH:mm:ss (wall clock)
  to?: string;
}

/** A punch as the API returns it (snake_case, wall-clock strings, labels and employee name joined). */
export interface Punch {
  id: number;
  emp_code: string;
  punch_time: string;
  punch_state: string | null;
  punch_state_label: string;
  verify_type: number | null;
  verify_type_label: string;
  work_code: string | null;
  terminal_sn: string | null;
  terminal_alias: string | null;
  area_alias: string | null;
  upload_time: string | null;
  source: 'biotime' | 'device';
  employee_name: string;
  department_name: string | null;
}

interface RawPunch {
  id: number;
  emp_code: string;
  punch_time: string;
  punch_state: string | null;
  verify_type: number | null;
  work_code: string | null;
  terminal_sn: string | null;
  terminal_alias: string | null;
  area_alias: string | null;
  upload_time: string | null;
  source: 'biotime' | 'device';
  employee_name: string | null;
  department_name: string | null;
}

const strOrNull = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max));
const num = (v: unknown) => Number(v ?? 0); // raw COUNT() comes back as BigInt

/** Timestamp column → "YYYY-MM-DD HH:mm:ss" text, so raw rows never go through Date conversion. */
const ts = (column: string) => Prisma.raw(`DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:%s')`);

/**
 * Employees joined through a derived table that keeps one row per emp_code,
 * so a code reused after a delete can never duplicate punches.
 */
const EMPLOYEE_JOIN = Prisma.sql`LEFT JOIN (
    SELECT e1.emp_code, e1.first_name, e1.last_name, e1.department_id, e1.department_name
    FROM employees e1
    JOIN (SELECT emp_code, MAX(id) AS id FROM employees WHERE is_deleted = false GROUP BY emp_code) last_e ON last_e.id = e1.id
  ) e ON e.emp_code = p.emp_code`;

const SELECT = Prisma.sql`SELECT p.id, p.emp_code,
    ${ts('p.punch_time')} AS punch_time,
    p.punch_state, p.verify_type, p.work_code, p.terminal_sn, p.terminal_alias, p.area_alias,
    ${ts('p.upload_time')} AS upload_time, p.source AS source,
    NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), '') AS employee_name,
    e.department_name
  FROM punches p ${EMPLOYEE_JOIN}`;

function where(f: PunchFilters) {
  const parts: Prisma.Sql[] = [];
  if (f.from) parts.push(Prisma.sql`p.punch_time >= ${toDb(f.from)}`);
  if (f.to) parts.push(Prisma.sql`p.punch_time <= ${toDb(f.to)}`);
  if (f.empCode) parts.push(Prisma.sql`p.emp_code = ${f.empCode}`);
  if (f.terminalSn) parts.push(Prisma.sql`p.terminal_sn = ${f.terminalSn}`);
  if (f.departmentId) parts.push(Prisma.sql`e.department_id = ${f.departmentId}`);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // MySQL's default collation compares case-insensitively, so LIKE matches "ali" and "Ali"
    parts.push(Prisma.sql`(p.emp_code LIKE ${like} OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE ${like})`);
  }
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

/** Earliest and latest of a non-empty list (no spread: device logs can be very long). */
function timeRange(dates: Date[]): [Date, Date] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of dates) {
    const t = d.getTime();
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [new Date(lo), new Date(hi)];
}

/** Identity of a punch across sources: same person, same second, same device. */
function punchKey(empCode: string, punchTime: string | null, terminalSn: string | null) {
  return `${empCode}|${punchTime ?? ''}|${terminalSn ?? ''}`;
}

function decorate(r: RawPunch): Punch {
  return {
    ...r,
    id: Number(r.id),
    verify_type: r.verify_type === null ? null : Number(r.verify_type),
    punch_state_label: punchStateLabel(r.punch_state),
    verify_type_label: verifyTypeLabel(r.verify_type),
    employee_name: r.employee_name ?? '',
  };
}

export const punchesRepo = {
  /**
   * Save punches from BioTime. Punches never change once recorded, so only new ids are inserted.
   * A punch that was already read directly from the device (same person, time and device) is replaced
   * by the BioTime row, but is not reported as new: its webhook was already sent.
   * Returns the ids that were new to the database (these are what webhooks announce).
   */
  async insertNew(list: BtTransaction[], syncRunId: number, syncedAt: Date): Promise<number[]> {
    const created: number[] = [];
    for (let i = 0; i < list.length; i += 1000) {
      const chunk = list.slice(i, i + 1000);
      const existing = new Set(
        (await prisma.punch.findMany({ select: { id: true }, where: { id: { in: chunk.map((t) => t.id) } } })).map((p) => p.id),
      );
      const fresh = chunk.filter((t) => !existing.has(t.id) && toDb(t.punch_time));
      if (!fresh.length) continue;

      // Device-read copies of these punches, keyed by emp_code|punch_time|terminal_sn
      const [from, to] = timeRange(fresh.map((t) => toDb(t.punch_time)!));
      const deviceRows = await prisma.punch.findMany({
        select: { id: true, empCode: true, punchTime: true, terminalSn: true, syncRunId: true },
        where: { source: 'device', punchTime: { gte: from, lte: to } },
      });
      const deviceByKey = new Map(deviceRows.map((p) => [punchKey(p.empCode, fromDb(p.punchTime), p.terminalSn), p]));
      const replaced = fresh
        .map((t) => ({ t, dup: deviceByKey.get(punchKey(String(t.emp_code), fromDb(toDb(t.punch_time)), t.terminal_sn)) }))
        .filter((x): x is { t: BtTransaction; dup: NonNullable<typeof x.dup> } => Boolean(x.dup));
      const replacedIds = new Set(replaced.map((x) => x.t.id));
      const firstRun = new Map(replaced.map((x) => [x.t.id, x.dup.syncRunId]));

      await prisma.$transaction([
        prisma.punch.deleteMany({ where: { id: { in: replaced.map((x) => x.dup.id) } } }),
        prisma.punch.createMany({
          skipDuplicates: true,
          data: fresh.map((t) => ({
            id: t.id,
            source: 'biotime' as const,
            empCode: String(t.emp_code).slice(0, 32),
            punchTime: toDb(t.punch_time)!,
            punchState: strOrNull(t.punch_state, 8),
            verifyType: t.verify_type === null || t.verify_type === undefined ? null : Number(t.verify_type),
            workCode: strOrNull(t.work_code, 32),
            terminalSn: strOrNull(t.terminal_sn, 64),
            terminalAlias: strOrNull(t.terminal_alias, 128),
            areaAlias: strOrNull(t.area_alias, 128),
            uploadTime: toDb(t.upload_time),
            // Keep "the run that first saved this punch" pointing at the device run
            syncRunId: firstRun.get(t.id) ?? syncRunId,
            syncedAt,
          })),
        }),
      ]);
      created.push(...fresh.filter((t) => !replacedIds.has(t.id)).map((t) => t.id));
    }
    return created;
  },

  /**
   * Save punches read directly from a device (zkteco-js). Skips any punch already stored from either
   * source (same emp_code, punch_time and terminal_sn). New rows get negative ids so they can never
   * collide with BioTime transaction ids. Returns the new ids.
   */
  async insertFromDevice(list: ZkPunch[], syncRunId: number | null, syncedAt: Date): Promise<number[]> {
    // Drop repeats inside the device log itself
    const unique = new Map<string, ZkPunch>();
    for (const p of list) if (toDb(p.punch_time)) unique.set(punchKey(p.emp_code, p.punch_time, p.terminal_sn), p);
    if (!unique.size) return [];

    const rows = [...unique.values()];
    const sns = [...new Set(rows.map((p) => p.terminal_sn))];
    const [from, to] = timeRange(rows.map((p) => toDb(p.punch_time)!));
    const stored = await prisma.punch.findMany({
      select: { empCode: true, punchTime: true, terminalSn: true },
      where: { terminalSn: { in: sns }, punchTime: { gte: from, lte: to } },
    });
    const have = new Set(stored.map((p) => punchKey(p.empCode, fromDb(p.punchTime), p.terminalSn)));
    const fresh = rows.filter((p) => !have.has(punchKey(p.emp_code, p.punch_time, p.terminal_sn)));
    if (!fresh.length) return [];

    // Name the device the way BioTime does, when BioTime knows it
    const known = await prisma.device.findMany({ select: { sn: true, alias: true, areaName: true }, where: { sn: { in: sns } } });
    const bySn = new Map(known.map((d) => [d.sn, d]));

    const ids: number[] = [];
    for (let i = 0; i < fresh.length; i += 1000) {
      const chunk = fresh.slice(i, i + 1000);
      await prisma.$transaction(async (tx) => {
        // Serialise id allocation for device punches (a named lock, held until the end of this transaction)
        await tx.$queryRaw`SELECT GET_LOCK('zk_punch_ids', 30)`;
        try {
        const [{ min }] = await tx.$queryRaw<[{ min: number | null }]>`SELECT MIN(id) AS min FROM punches`;
        const start = Math.min(Number(min ?? 0), 0) - 1;
        const data = chunk.map((p, k) => ({
          id: start - k,
          source: 'device' as const,
          empCode: p.emp_code.slice(0, 32),
          punchTime: toDb(p.punch_time)!,
          punchState: strOrNull(p.punch_state, 8),
          verifyType: p.verify_type,
          workCode: strOrNull(p.work_code, 32),
          terminalSn: p.terminal_sn.slice(0, 64),
          terminalAlias: bySn.get(p.terminal_sn)?.alias ?? null,
          areaAlias: bySn.get(p.terminal_sn)?.areaName ?? null,
          uploadTime: syncedAt,
          syncRunId,
          syncedAt,
        }));
        await tx.punch.createMany({ data });
        ids.push(...data.map((d) => d.id));
        } finally {
          await tx.$queryRaw`SELECT RELEASE_LOCK('zk_punch_ids')`;
        }
      });
    }
    return ids;
  },

  async page(f: PunchFilters, limit: number, offset: number) {
    const w = where(f);
    const [rows, total] = await Promise.all([
      prisma.$queryRaw<RawPunch[]>`${SELECT} ${w} ORDER BY p.punch_time DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM punches p ${EMPLOYEE_JOIN} ${w}`,
    ]);
    return { count: num(total[0]?.n), data: rows.map(decorate) };
  },

  async all(f: PunchFilters, max = 200_000) {
    const rows = await prisma.$queryRaw<RawPunch[]>`${SELECT} ${where(f)} ORDER BY p.punch_time, p.id LIMIT ${max}`;
    return rows.map(decorate);
  },

  async latest(limit: number, f: PunchFilters = {}) {
    const rows = await prisma.$queryRaw<RawPunch[]>`${SELECT} ${where(f)} ORDER BY p.punch_time DESC, p.id DESC LIMIT ${limit}`;
    return rows.map(decorate);
  },

  /** Punches from `from` (local "YYYY-MM-DD HH:mm:ss") onwards, oldest first. */
  async since(from: string, limit = 50_000) {
    const rows = await prisma.$queryRaw<RawPunch[]>`${SELECT} WHERE p.punch_time >= ${toDb(from)} ORDER BY p.punch_time, p.id LIMIT ${limit}`;
    return rows.map(decorate);
  },

  async byIds(ids: number[]) {
    if (!ids.length) return [];
    const rows = await prisma.$queryRaw<RawPunch[]>`${SELECT} WHERE p.id IN (${Prisma.join(ids)}) ORDER BY p.punch_time, p.id`;
    return rows.map(decorate);
  },

  /** Punch count, distinct people and per-hour histogram for a time window. */
  async daySummary(from: string, to: string) {
    const [a, b] = [toDb(from), toDb(to)];
    const [totals, hours] = await Promise.all([
      prisma.$queryRaw<{ punches: bigint; people: bigint }[]>`
        SELECT COUNT(*) AS punches, COUNT(DISTINCT emp_code) AS people FROM punches WHERE punch_time BETWEEN ${a} AND ${b}`,
      prisma.$queryRaw<{ hour: number; count: bigint }[]>`
        SELECT HOUR(punch_time) AS hour, COUNT(*) AS count FROM punches WHERE punch_time BETWEEN ${a} AND ${b} GROUP BY 1`,
    ]);
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    for (const h of hours) {
      const slot = hourly[Number(h.hour)];
      if (slot) slot.count = num(h.count);
    }
    return { punches: num(totals[0]?.punches), people: num(totals[0]?.people), hourly };
  },

  /** Attendance-enabled employees with no punch in the window. */
  async absentCount(from: string, to: string) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT e.emp_code) AS n FROM employees e
      WHERE e.is_deleted = false AND e.enable_att = true
        AND NOT EXISTS (SELECT 1 FROM punches p WHERE p.emp_code = e.emp_code AND p.punch_time BETWEEN ${toDb(from)} AND ${toDb(to)})`;
    return num(rows[0]?.n);
  },

  /** One row per employee per day: first/last punch, count, devices. */
  async daily(from: string, to: string, empCode?: string) {
    const extra = empCode ? Prisma.sql`AND p.emp_code = ${empCode}` : Prisma.empty;
    const rows = await prisma.$queryRaw<
      { emp_code: string; date: string; first_punch: string; last_punch: string; punch_count: bigint; terminals: string | null }[]
    >`
      SELECT p.emp_code,
        DATE_FORMAT(p.punch_time, '%Y-%m-%d') AS date,
        ${ts('MIN(p.punch_time)')} AS first_punch,
        ${ts('MAX(p.punch_time)')} AS last_punch,
        COUNT(*) AS punch_count,
        GROUP_CONCAT(DISTINCT COALESCE(p.terminal_alias, p.terminal_sn) SEPARATOR ', ') AS terminals
      FROM punches p
      WHERE p.punch_time BETWEEN ${toDb(from)} AND ${toDb(to)} ${extra}
      GROUP BY p.emp_code, DATE(p.punch_time)`;
    return rows.map((r) => ({ ...r, punch_count: num(r.punch_count) }));
  },

  async stats() {
    const rows = await prisma.$queryRaw<{ n: bigint; first: string | null; last: string | null }[]>`
      SELECT COUNT(*) AS n,
        ${ts('MIN(punch_time)')} AS first,
        ${ts('MAX(punch_time)')} AS last
      FROM punches`;
    return { total: num(rows[0]?.n), first: rows[0]?.first ?? null, last: rows[0]?.last ?? null };
  },
};
