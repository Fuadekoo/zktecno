import type { Request } from 'express';
import { prisma, Prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';

export const auditRepo = {
  /** Record who did what. Never throws: an audit failure must not break the action itself. */
  async log(
    req: Request | null,
    entry: { action: string; entity: string; entityId?: string | number | null; summary?: string; details?: unknown; username?: string },
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: req?.user?.id ?? null,
          username: entry.username ?? req?.user?.username ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
          summary: entry.summary?.slice(0, 255) ?? null,
          details: entry.details === undefined ? Prisma.DbNull : (entry.details as Prisma.InputJsonValue),
          ip: req?.ip ?? null,
          createdAt: dbNow(),
        },
      });
    } catch (err) {
      console.error('[audit] Failed to write audit log:', (err as Error).message);
    }
  },

  async page(limit: number, offset: number, entity?: string) {
    const where = entity ? { entity } : {};
    const [rows, count] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset }),
      prisma.auditLog.count({ where }),
    ]);
    return {
      count,
      data: rows.map((a) => ({
        id: a.id,
        username: a.username,
        action: a.action,
        entity: a.entity,
        entity_id: a.entityId,
        summary: a.summary,
        details: a.details,
        ip: a.ip,
        created_at: fromDb(a.createdAt),
      })),
    };
  },
};
