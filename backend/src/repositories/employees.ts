import type { BtEmployee } from '../biotime/types.js';
import { prisma } from '../db/prisma.js';
import type { Employee } from '../generated/prisma/client.js';

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

  /** Employees not seen in the latest full sync no longer exist in BioTime. */
  async markMissingAsDeleted(syncedAt: Date) {
    const r = await prisma.employee.updateMany({ where: { syncedAt: { lt: syncedAt }, isDeleted: false }, data: { isDeleted: true } });
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
