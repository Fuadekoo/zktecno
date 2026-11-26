/**
 * Departments, areas and positions stored in PostgreSQL (used when BioTime is off).
 * They are served in the same shape as the BioTime API (dept_code / dept_name / parent_dept, …),
 * so the existing pages work unchanged.
 */
import { prisma, Prisma } from '../db/prisma.js';
import { dbNow } from '../db/time.js';
import type { OrgUnit, OrgUnitKind } from '../generated/prisma/client.js';
import { HttpError } from '../utils/http.js';

export type { OrgUnitKind };

const KEYS: Record<OrgUnitKind, { code: string; name: string; parent: string; label: string }> = {
  department: { code: 'dept_code', name: 'dept_name', parent: 'parent_dept', label: 'department' },
  area: { code: 'area_code', name: 'area_name', parent: 'parent_area', label: 'area' },
  position: { code: 'position_code', name: 'position_name', parent: 'parent_position', label: 'position' },
};

type Rec = Record<string, unknown> & { id?: number };

function toApi(kind: OrgUnitKind, u: OrgUnit): Rec {
  const k = KEYS[kind];
  return { id: u.id, [k.code]: u.code, [k.name]: u.name, [k.parent]: u.parentId };
}

/** Body from the page ({dept_code, dept_name, parent_dept}) to columns. */
function fromBody(kind: OrgUnitKind, body: Rec) {
  const k = KEYS[kind];
  const data: { code?: string; name?: string; parentId?: number | null } = {};
  if (body[k.code] !== undefined) data.code = String(body[k.code]);
  if (body[k.name] !== undefined) data.name = String(body[k.name]);
  if (body[k.parent] !== undefined) data.parentId = (body[k.parent] as number | null) ?? null;
  return data;
}

function duplicateCode(kind: OrgUnitKind) {
  return (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, `Another ${KEYS[kind].label} already uses this code`, { [KEYS[kind].code]: 'Already used' });
    }
    throw err;
  };
}

/** Parent must exist, be the same kind, and not create a loop. */
async function checkParent(kind: OrgUnitKind, id: number | null, parentId: number | null | undefined) {
  if (!parentId) return;
  const field = KEYS[kind].parent;
  const all = new Map((await prisma.orgUnit.findMany({ where: { kind } })).map((u) => [u.id, u]));
  if (!all.has(parentId)) throw new HttpError(400, `Parent ${KEYS[kind].label} not found`, { [field]: 'Not found' });
  for (let p: number | null = parentId, i = 0; p && i < 1000; p = all.get(p)?.parentId ?? null, i++) {
    if (p === id) throw new HttpError(400, `A ${KEYS[kind].label} can’t be inside itself`, { [field]: 'Would create a loop' });
  }
}

/** Re-copy department/position/area names onto employees (they are stored with each employee for reports). */
async function refreshEmployeeNames(kind: OrgUnitKind) {
  const units = new Map((await prisma.orgUnit.findMany({ where: { kind } })).map((u) => [u.id, u.name]));
  if (kind === 'department') {
    const rows = await prisma.employee.findMany({ where: { departmentId: { not: null } }, select: { id: true, departmentId: true, departmentName: true } });
    for (const e of rows) {
      const name = units.get(e.departmentId!) ?? null;
      const departmentId = units.has(e.departmentId!) ? e.departmentId : null;
      if (name !== e.departmentName || departmentId !== e.departmentId) await prisma.employee.update({ where: { id: e.id }, data: { departmentName: name, departmentId } });
    }
  } else if (kind === 'position') {
    const rows = await prisma.employee.findMany({ where: { positionId: { not: null } }, select: { id: true, positionId: true, positionName: true } });
    for (const e of rows) {
      const name = units.get(e.positionId!) ?? null;
      const positionId = units.has(e.positionId!) ? e.positionId : null;
      if (name !== e.positionName || positionId !== e.positionId) await prisma.employee.update({ where: { id: e.id }, data: { positionName: name, positionId } });
    }
  } else {
    const rows = await prisma.employee.findMany({ where: { areaIds: { not: Prisma.AnyNull } }, select: { id: true, areaIds: true, areaNames: true } });
    for (const e of rows) {
      const ids = (Array.isArray(e.areaIds) ? (e.areaIds as number[]) : []).filter((id) => units.has(id));
      const names = ids.map((id) => units.get(id)).join(', ') || null;
      if (names !== e.areaNames || ids.length !== (e.areaIds as number[]).length) await prisma.employee.update({ where: { id: e.id }, data: { areaNames: names, areaIds: ids } });
    }
  }
}

/** Repository for one kind, with the controller's list/get/create/update/remove shape. */
export function orgUnitsRepo(kind: OrgUnitKind) {
  const k = KEYS[kind];
  return {
    async list(filters: Record<string, string>, page: number, pageSize: number) {
      const where: Prisma.OrgUnitWhereInput = { kind };
      if (filters[k.code]) where.code = { contains: filters[k.code], mode: 'insensitive' };
      if (filters[k.name]) where.name = { contains: filters[k.name], mode: 'insensitive' };
      if (filters[k.parent] && Number.isInteger(Number(filters[k.parent]))) where.parentId = Number(filters[k.parent]);
      const [count, rows] = await Promise.all([
        prisma.orgUnit.count({ where }),
        prisma.orgUnit.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { count, hasNext: page * pageSize < count, hasPrevious: page > 1, data: rows.map((u) => toApi(kind, u)) };
    },

    async get(id: number) {
      const u = await prisma.orgUnit.findFirst({ where: { id, kind } });
      return u ? toApi(kind, u) : null;
    },

    async create(body: Rec) {
      const data = fromBody(kind, body);
      await checkParent(kind, null, data.parentId);
      const now = dbNow();
      const u = await prisma.orgUnit
        .create({ data: { kind, code: data.code!, name: data.name!, parentId: data.parentId ?? null, createdAt: now, updatedAt: now } })
        .catch(duplicateCode(kind));
      return toApi(kind, u);
    },

    async update(id: number, body: Rec) {
      if (!(await prisma.orgUnit.findFirst({ where: { id, kind } }))) throw new HttpError(404, `${k.label} not found`);
      const data = fromBody(kind, body);
      await checkParent(kind, id, data.parentId);
      const u = await prisma.orgUnit.update({ where: { id }, data: { ...data, updatedAt: dbNow() } }).catch(duplicateCode(kind));
      if (data.name !== undefined) await refreshEmployeeNames(kind);
      return toApi(kind, u);
    },

    /** Children move up to no parent; employees are unassigned. */
    async remove(id: number) {
      const u = await prisma.orgUnit.findFirst({ where: { id, kind } });
      if (!u) throw new HttpError(404, `${k.label} not found`);
      await prisma.$transaction([prisma.orgUnit.updateMany({ where: { parentId: id }, data: { parentId: null } }), prisma.orgUnit.delete({ where: { id } })]);
      await refreshEmployeeNames(kind);
      return toApi(kind, u);
    },

    /** id -> name, for copying names onto employees. */
    async names(ids: number[]) {
      if (!ids.length) return new Map<number, string>();
      const rows = await prisma.orgUnit.findMany({ where: { kind, id: { in: ids } } });
      return new Map(rows.map((u) => [u.id, u.name]));
    },
  };
}

export const departmentsRepo = orgUnitsRepo('department');
export const areasRepo = orgUnitsRepo('area');
export const positionsRepo = orgUnitsRepo('position');
