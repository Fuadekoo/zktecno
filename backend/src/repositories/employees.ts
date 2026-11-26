import type { BtEmployee } from '../biotime/types.js';
import { prisma } from '../db/prisma.js';
import type { Employee, Prisma } from '../generated/prisma/client.js';
import type { ZkUser } from '../zk/client.js';
import { HttpError } from '../utils/http.js';
import { dbNow } from '../db/time.js';
import { biometricsRepo } from './biometrics.js';
import { deviceCommandsRepo } from './deviceCommands.js';
import { areasRepo, departmentsRepo, positionsRepo } from './orgUnits.js';

export type { Employee };

export function employeeName(e: { firstName?: string | null; lastName?: string | null } | null | undefined) {
  return [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim();
}

const trunc = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max));

function fromBioTime(e: BtEmployee, syncedAt: Date) {
  const dept = e.department;
  const pos = e.position;
  const areas = (e.area ?? [])
    .map((a) => (typeof a === 'object' && a ? (a.area_name as string | undefined) : undefined))
    .filter(Boolean)
    .join(', ');
  const deptId = typeof dept === 'object' && dept ? dept.id : dept;
  return {
    empCode: String(e.emp_code).slice(0, 32),
    firstName: trunc(e.first_name, 100),
    lastName: trunc(e.last_name, 100),
    departmentId: typeof deptId === 'number' ? deptId : null,
    departmentName: trunc(e.dept_name ?? (typeof dept === 'object' && dept ? dept.dept_name : null), 128),
    positionName: trunc(e.position_name ?? (typeof pos === 'object' && pos ? pos.position_name : null), 128),
    areaNames: trunc(e.area_name || areas, 512),
    cardNo: trunc(e.card_no, 32),
    mobile: trunc(e.mobile, 32),
    email: trunc(e.email, 128),
    gender: trunc(e.gender, 8),
    hireDate: e.hire_date ? String(e.hire_date).slice(0, 10) : null,
    enableAtt: e.enable_att !== false,
    isDeleted: false,
    syncedAt,
  };
}

/** A database row in the BioTime employee shape the frontend reads. */
function toApiShape(e: Employee) {
  return {
    id: e.id,
    emp_code: e.empCode,
    first_name: e.firstName,
    last_name: e.lastName,
    department: e.departmentId,
    dept_name: e.departmentName,
    position: e.positionId,
    position_name: e.positionName,
    area: Array.isArray(e.areaIds) ? (e.areaIds as number[]) : [],
    area_name: e.areaNames,
    card_no: e.cardNo,
    mobile: e.mobile,
    email: e.email,
    gender: e.gender,
    hire_date: e.hireDate,
    enable_att: e.enableAtt,
    device_password: e.devicePassword,
    dev_privilege: e.devPrivilege,
    created_in_app: e.createdInApp,
  };
}

/** Device user IDs: digits only (what every ZKTeco firmware accepts), at most 9 so older devices work too. */
const PIN_RE = /^[0-9]{1,9}$/;
const DEVICE_ROLES = [0, 2, 6, 14];

const text = (v: unknown, max: number) => (v === undefined ? undefined : v === null || v === '' ? null : String(v).slice(0, max));

/** Department/position/area fields from a form body, with their names copied for reports. */
async function orgFields(b: Record<string, unknown>) {
  const data: Prisma.EmployeeUpdateInput = {};
  if (b.department !== undefined) {
    const deptId = (b.department as number | null) || null;
    const name = deptId ? (await departmentsRepo.names([deptId])).get(deptId) : null;
    if (deptId && !name) throw new HttpError(400, 'Department not found', { department: 'Not found' });
    data.departmentId = deptId;
    data.departmentName = name ?? null;
  }
  if (b.position !== undefined) {
    const posId = (b.position as number | null) || null;
    const name = posId ? (await positionsRepo.names([posId])).get(posId) : null;
    if (posId && !name) throw new HttpError(400, 'Position not found', { position: 'Not found' });
    data.positionId = posId;
    data.positionName = name ?? null;
  }
  if (b.area !== undefined) {
    const ids = [...new Set((b.area as number[]) ?? [])];
    const names = await areasRepo.names(ids);
    const valid = ids.filter((i) => names.has(i));
    data.areaIds = valid;
    data.areaNames = valid.map((i) => names.get(i)).join(', ').slice(0, 512) || null;
  }
  return data;
}

/** Personal and device fields from a form body (undefined = not sent = unchanged). */
function detailFields(b: Record<string, unknown>) {
  const data: Prisma.EmployeeUpdateInput = {};
  if (b.first_name !== undefined) data.firstName = text(b.first_name, 100);
  if (b.last_name !== undefined) data.lastName = text(b.last_name, 100);
  if (b.card_no !== undefined) {
    const card = text(b.card_no, 32);
    if (card && !/^\d{1,10}$/.test(card)) throw new HttpError(400, 'The card number must be digits only (up to 10)', { card_no: 'Digits only, up to 10' });
    data.cardNo = card;
  }
  if (b.device_password !== undefined) {
    const pw = text(b.device_password, 8);
    if (pw && !/^\d{1,8}$/.test(pw)) throw new HttpError(400, 'The device password must be digits only (up to 8)', { device_password: 'Digits only, up to 8' });
    data.devicePassword = pw;
  }
  if (b.dev_privilege !== undefined) {
    const role = Number(b.dev_privilege);
    if (!DEVICE_ROLES.includes(role)) throw new HttpError(400, 'Unknown device role', { dev_privilege: 'Pick a role' });
    data.devPrivilege = role;
  }
  if (b.mobile !== undefined) data.mobile = text(b.mobile, 32);
  if (b.email !== undefined) data.email = text(b.email, 128);
  if (b.gender !== undefined) data.gender = text(b.gender, 8);
  if (b.hire_date !== undefined) data.hireDate = text(b.hire_date, 10);
  if (b.enable_att !== undefined) data.enableAtt = Boolean(b.enable_att);
  return data;
}

export const employeesRepo = {
  /** Insert or update BioTime employees. Returns how many were new vs refreshed. */
  async upsertMany(list: BtEmployee[], syncedAt: Date) {
    const existing = new Set(
      (await prisma.employee.findMany({ select: { id: true }, where: { id: { in: list.map((e) => e.id) } } })).map((e) => e.id),
    );
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      await prisma.$transaction(
        chunk.map((e) => {
          const data = fromBioTime(e, syncedAt);
          return prisma.employee.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data });
        }),
      );
    }
    const created = list.filter((e) => !existing.has(e.id)).length;
    return { created, updated: list.length - created };
  },

  /**
   * Insert or update users read from the devices (no BioTime). Matched by emp_code; new ones get
   * negative ids so they can never collide with BioTime ids. The card comes from the device; the name
   * too, unless it was already filled in (or edited) in the dashboard. Other fields are left as they are.
   */
  async upsertFromDevice(list: ZkUser[], syncedAt: Date) {
    const existing = new Map(
      (
        await prisma.employee.findMany({ select: { id: true, empCode: true, firstName: true, lastName: true }, where: { empCode: { in: list.map((u) => u.emp_code) } } })
      ).map((e) => [e.empCode, e]),
    );
    let nextId = Math.min(0, (await prisma.employee.aggregate({ _min: { id: true } }))._min.id ?? 0) - 1;
    let created = 0;
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      await prisma.$transaction(
        chunk.map((u) => {
          const data = {
            empCode: u.emp_code.slice(0, 32),
            firstName: trunc(u.name, 100),
            cardNo: trunc(u.card_no, 32),
            isDeleted: false,
            syncedAt,
          };
          const found = existing.get(u.emp_code);
          if (found) {
            const keepName = Boolean(found.firstName || found.lastName);
            return prisma.employee.update({ where: { id: found.id }, data: keepName ? { ...data, firstName: undefined } : data });
          }
          created++;
          return prisma.employee.create({ data: { id: nextId--, ...data } });
        }),
      );
    }
    return { created, updated: list.length - created };
  },

  /** One page of employees from the database, in the same shape the BioTime API returns. */
  async listLocal(filters: Record<string, string>, page: number, pageSize: number) {
    const where: Prisma.EmployeeWhereInput = { isDeleted: false };
    if (filters.emp_code) where.empCode = { contains: filters.emp_code };
    if (filters.first_name) where.firstName = { contains: filters.first_name };
    if (filters.last_name) where.lastName = { contains: filters.last_name };
    if (filters.department && Number.isInteger(Number(filters.department))) where.departmentId = Number(filters.department);
    const [count, rows] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({ where, orderBy: { empCode: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const codes = rows.map((e) => e.empCode);
    const [bio, cmds] = await Promise.all([biometricsRepo.counts(codes), deviceCommandsRepo.latestUserCommands(codes)]);
    const data = rows.map((e) => {
      const latest = cmds.filter((c) => c.emp_code === e.empCode && c.kind === 'user_upsert');
      return {
        ...toApiShape(e),
        biometrics: bio.get(e.empCode) ?? { fingerprints: 0, faces: 0 },
        device_sync: latest.length
          ? {
              devices: latest.length,
              done: latest.filter((c) => c.status === 'success').length,
              pending: latest.filter((c) => c.status === 'pending' || c.status === 'sent').length,
              failed: latest.filter((c) => c.status === 'failed').length,
            }
          : null,
      };
    });
    return { count, hasNext: page * pageSize < count, hasPrevious: page > 1, data };
  },

  /**
   * Add a person here (BioTime off). They are then sent to every device. A deleted person with the same
   * code is brought back instead of creating a duplicate.
   */
  async createLocal(b: Record<string, unknown>) {
    const empCode = String(b.emp_code ?? '').trim();
    if (!PIN_RE.test(empCode)) {
      throw new HttpError(400, 'The employee code is the user ID on the device: digits only, up to 9', { emp_code: 'Digits only, up to 9 (e.g. 1001)' });
    }
    const existing = await prisma.employee.findFirst({ where: { empCode }, orderBy: { isDeleted: 'asc' } });
    if (existing && !existing.isDeleted) throw new HttpError(409, `Employee code ${empCode} is already used`, { emp_code: 'Already used' });
    const data = { ...detailFields(b), ...(await orgFields(b)), isDeleted: false, createdInApp: true, syncedAt: dbNow() };
    if (existing) return toApiShape(await prisma.employee.update({ where: { id: existing.id }, data }));
    const nextId = Math.min(0, (await prisma.employee.aggregate({ _min: { id: true } }))._min.id ?? 0) - 1;
    return toApiShape(await prisma.employee.create({ data: { ...(data as Prisma.EmployeeCreateInput), id: nextId, empCode } }));
  },

  /** Delete here (BioTime off); the caller removes the person from the devices. */
  async removeLocal(id: number) {
    const e = await prisma.employee.findFirst({ where: { id, isDeleted: false } });
    if (!e) throw new HttpError(404, 'Employee not found');
    await prisma.employee.update({ where: { id }, data: { isDeleted: true } });
    return toApiShape(e);
  },

  /** Including deleted ones (to remove a just-deleted person from devices). */
  byIdAny: (id: number) => prisma.employee.findUnique({ where: { id } }),

  async getLocal(id: number) {
    const e = await prisma.employee.findFirst({ where: { id, isDeleted: false } });
    return e ? toApiShape(e) : null;
  },

  /**
   * Edit an employee in the database (BioTime off): details, department, position and areas.
   * Names of the chosen department/position/areas are copied onto the employee for reports.
   */
  async updateLocal(id: number, b: Record<string, unknown>) {
    const e = await prisma.employee.findFirst({ where: { id, isDeleted: false } });
    if (!e) throw new HttpError(404, 'Employee not found');
    if (b.emp_code !== undefined && b.emp_code !== e.empCode) {
      throw new HttpError(400, 'The employee code comes from the device and can’t be changed here', { emp_code: 'Change it on the device' });
    }
    const data: Prisma.EmployeeUpdateInput = { ...detailFields(b), ...(await orgFields(b)) };
    return toApiShape(await prisma.employee.update({ where: { id }, data }));
  },

  /** Employees not seen in the latest full sync no longer exist in BioTime. */
  async markMissingAsDeleted(syncedAt: Date, opts: { keepCreatedInApp?: boolean } = {}) {
    const r = await prisma.employee.updateMany({
      // People added in the dashboard may not have reached the devices yet (or only push devices have them)
      where: { syncedAt: { lt: syncedAt }, isDeleted: false, ...(opts.keepCreatedInApp && { createdInApp: false }) },
      data: { isDeleted: true },
    });
    return r.count;
  },

  markDeleted: (id: number) => prisma.employee.updateMany({ where: { id }, data: { isDeleted: true } }),

  active: () => prisma.employee.findMany({ where: { isDeleted: false }, orderBy: { empCode: 'asc' } }),

  async byCodes(codes: string[]) {
    if (!codes.length) return new Map<string, Employee>();
    const rows = await prisma.employee.findMany({ where: { empCode: { in: codes }, isDeleted: false } });
    return new Map(rows.map((e) => [e.empCode, e]));
  },

  async counts() {
    const [total, attendance_enabled] = await Promise.all([
      prisma.employee.count({ where: { isDeleted: false } }),
      prisma.employee.count({ where: { isDeleted: false, enableAtt: true } }),
    ]);
    return { total, attendance_enabled };
  },
};
