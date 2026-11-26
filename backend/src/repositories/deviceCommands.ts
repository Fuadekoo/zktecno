import { prisma, Prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { CommandChannel, CommandStatus, DeviceCommand } from '../generated/prisma/client.js';

export type { CommandChannel, CommandStatus, DeviceCommand };

export type CommandKind =
  | 'user_upsert'
  | 'user_delete'
  | 'template_upsert'
  | 'enroll_fp'
  | 'query_attlog'
  | 'query_users'
  | 'reboot'
  | 'check';

export interface NewCommand {
  deviceId: number;
  channel: CommandChannel;
  kind: CommandKind;
  command: string;
  payload?: unknown;
  empCode?: string | null;
  createdBy?: string | null;
}

type WithDevice = DeviceCommand & { device?: { name: string } | null };

export function toApi(c: WithDevice) {
  return {
    id: c.id,
    device_id: c.deviceId,
    device_name: c.device?.name ?? null,
    channel: c.channel,
    kind: c.kind,
    // Templates are long base64 strings: show the start only
    command: c.kind === 'template_upsert' ? `${c.command.slice(0, 120)}…` : c.command,
    emp_code: c.empCode,
    status: c.status,
    attempts: c.attempts,
    next_attempt_at: fromDb(c.nextAttemptAt),
    return_code: c.returnCode,
    result: c.result,
    created_by: c.createdBy,
    created_at: fromDb(c.createdAt),
    sent_at: fromDb(c.sentAt),
    completed_at: fromDb(c.completedAt),
  };
}

/** Kinds that replace each other: a newer add/remove of the same person makes an unsent older one pointless. */
const USER_KINDS: CommandKind[] = ['user_upsert', 'user_delete'];

export const deviceCommandsRepo = {
  async create(c: NewCommand) {
    if (c.empCode && USER_KINDS.includes(c.kind)) {
      await prisma.deviceCommand.updateMany({
        where: { deviceId: c.deviceId, empCode: c.empCode, kind: { in: USER_KINDS }, status: 'pending' },
        data: { status: 'cancelled', result: 'Replaced by a newer change', completedAt: dbNow() },
      });
    }
    return prisma.deviceCommand.create({
      data: {
        deviceId: c.deviceId,
        channel: c.channel,
        kind: c.kind,
        command: c.command,
        payload: c.payload === undefined ? Prisma.DbNull : (c.payload as Prisma.InputJsonValue),
        empCode: c.empCode ?? null,
        createdBy: c.createdBy ?? null,
        createdAt: dbNow(),
      },
    });
  },

  get: (id: number) => prisma.deviceCommand.findUnique({ where: { id }, include: { device: { select: { name: true } } } }),

  async page(f: { deviceId?: number; empCode?: string; status?: CommandStatus; kind?: string }, page: number, pageSize: number) {
    const where: Prisma.DeviceCommandWhereInput = {};
    if (f.deviceId) where.deviceId = f.deviceId;
    if (f.empCode) where.empCode = f.empCode;
    if (f.status) where.status = f.status;
    if (f.kind) where.kind = f.kind;
    const [count, rows] = await Promise.all([
      prisma.deviceCommand.count({ where }),
      prisma.deviceCommand.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { device: { select: { name: true } } } }),
    ]);
    return { count, hasNext: page * pageSize < count, hasPrevious: page > 1, data: rows.map(toApi) };
  },

  /** Push commands waiting for a device, oldest first, capped by count and total size. */
  async nextPush(deviceId: number, maxCount = 10, maxBytes = 60_000) {
    const rows = await prisma.deviceCommand.findMany({
      where: { deviceId, channel: 'push', status: 'pending' },
      orderBy: { id: 'asc' },
      take: maxCount,
    });
    const out: DeviceCommand[] = [];
    let bytes = 0;
    for (const r of rows) {
      if (out.length && bytes + r.command.length > maxBytes) break;
      out.push(r);
      bytes += r.command.length;
    }
    if (out.length) {
      await prisma.deviceCommand.updateMany({
        where: { id: { in: out.map((r) => r.id) } },
        data: { status: 'sent', sentAt: dbNow(), attempts: { increment: 1 } },
      });
    }
    return out;
  },

  /** A push device's reply: ID=…&Return=…&CMD=… */
  async complete(id: number, deviceId: number, returnCode: number, result: string) {
    const r = await prisma.deviceCommand.updateMany({
      where: { id, deviceId, status: { in: ['sent', 'pending'] } },
      data: { status: returnCode >= 0 ? 'success' : 'failed', returnCode, result: result.slice(0, 2000), completedAt: dbNow() },
    });
    return r.count > 0;
  },

  /** Next pull command due now. */
  nextPull: () =>
    prisma.deviceCommand.findFirst({
      where: { channel: 'pull', status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: dbNow() } }] },
      orderBy: { id: 'asc' },
      include: { device: true },
    }),

  finish: (id: number, ok: boolean, result: string, attempts: number) =>
    prisma.deviceCommand.update({
      where: { id },
      data: { status: ok ? 'success' : 'failed', result: result.slice(0, 2000), attempts, completedAt: dbNow(), nextAttemptAt: null },
    }),

  retryLater: (id: number, attempts: number, at: Date, error: string) =>
    prisma.deviceCommand.update({ where: { id }, data: { attempts, nextAttemptAt: at, result: error.slice(0, 2000) } }),

  /** Put a failed/cancelled (or stuck) command back in the queue. */
  requeue: (id: number) =>
    prisma.deviceCommand.update({
      where: { id },
      data: { status: 'pending', nextAttemptAt: null, sentAt: null, completedAt: null, returnCode: null, result: null },
    }),

  cancel: (id: number) =>
    prisma.deviceCommand.updateMany({
      where: { id, status: { in: ['pending', 'sent'] } },
      data: { status: 'cancelled', result: 'Cancelled', completedAt: dbNow() },
    }),

  /** Push commands the device took but never answered. */
  expireSent(olderThan: Date) {
    return prisma.deviceCommand.updateMany({
      where: { status: 'sent', sentAt: { lt: olderThan } },
      data: { status: 'failed', result: 'The device took the command but never replied', completedAt: dbNow() },
    });
  },

  pruneBefore: (before: Date) =>
    prisma.deviceCommand.deleteMany({ where: { createdAt: { lt: before }, status: { in: ['success', 'failed', 'cancelled'] } } }),

  /** Waiting work per device (for the devices list). */
  async pendingByDevice() {
    const rows = await prisma.deviceCommand.groupBy({ by: ['deviceId'], where: { status: { in: ['pending', 'sent'] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.deviceId, r._count._all]));
  },

  /** The latest add/remove command per device for each person: is the person on every device yet? */
  async latestUserCommands(empCodes: string[]) {
    if (!empCodes.length) return [];
    return prisma.$queryRaw<{ emp_code: string; device_id: number; kind: string; status: CommandStatus; result: string | null; created_at: Date }[]>`
      SELECT DISTINCT ON (emp_code, device_id) emp_code, device_id, kind, status, result, created_at
      FROM device_commands
      WHERE emp_code IN (${Prisma.join(empCodes)}) AND kind IN ('user_upsert', 'user_delete')
      ORDER BY emp_code, device_id, id DESC`;
  },
};
