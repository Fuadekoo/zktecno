import type { BtTerminal } from '../biotime/types.js';
import { prisma } from '../db/prisma.js';
import { fromDb, toDb } from '../db/time.js';

const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max));

export const devicesRepo = {
  /** Replace the device mirror with the current BioTime list. */
  async replaceAll(list: BtTerminal[], syncedAt: Date) {
    const existing = new Set((await prisma.device.findMany({ select: { id: true } })).map((d) => d.id));
    await prisma.$transaction(
      list.map((d) => {
        const data = {
          sn: String(d.sn).slice(0, 64),
          alias: strOrNull(d.alias, 128),
          ipAddress: strOrNull(d.ip_address, 64),
          state: intOrNull(d.state),
          areaName: strOrNull(d.area_name ?? d.area?.area_name, 128),
          fwVer: strOrNull(d.fw_ver, 64),
          lastActivity: toDb(d.last_activity),
          userCount: intOrNull(d.user_count),
          fpCount: intOrNull(d.fp_count),
          faceCount: intOrNull(d.face_count),
          transactionCount: intOrNull(d.transaction_count),
          syncedAt,
        };
        return prisma.device.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
      }),
    );
    const removed = await prisma.device.deleteMany({ where: { syncedAt: { lt: syncedAt } } });
    const created = list.filter((d) => !existing.has(d.id)).length;
    return { created, updated: list.length - created, removed: removed.count };
  },

  async all() {
    const rows = await prisma.device.findMany({ orderBy: [{ alias: 'asc' }, { sn: 'asc' }] });
    return rows.map((d) => ({
      id: d.id,
      sn: d.sn,
      alias: d.alias,
      ip_address: d.ipAddress,
      state: d.state,
      area_name: d.areaName,
      fw_ver: d.fwVer,
      last_activity: fromDb(d.lastActivity),
      user_count: d.userCount,
      fp_count: d.fpCount,
      face_count: d.faceCount,
      transaction_count: d.transactionCount,
      synced_at: fromDb(d.syncedAt),
    }));
  },

  count: () => prisma.device.count(),
};
