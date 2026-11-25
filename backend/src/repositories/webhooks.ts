import { prisma, Prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { Webhook, WebhookDelivery } from '../generated/prisma/client.js';

export const WEBHOOK_EVENTS = ['punch.created', 'sync.completed', 'sync.failed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'webhook.test';

const eventsOf = (w: Webhook) => (Array.isArray(w.events) ? (w.events as string[]) : []);

/** The secret is shown in full only to admins on the detail endpoint; lists show a hint. */
export function webhookToJson(w: Webhook, { revealSecret = false } = {}) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    events: eventsOf(w),
    is_active: w.isActive,
    secret: revealSecret ? w.secret : `${w.secret.slice(0, 6)}…`,
    last_delivery_at: fromDb(w.lastDeliveryAt),
    last_status: w.lastStatus,
    created_at: fromDb(w.createdAt),
    updated_at: fromDb(w.updatedAt),
  };
}

export function deliveryToJson(d: WebhookDelivery & { webhook?: { name: string } | null }, { includePayload = false } = {}) {
  return {
    id: d.id,
    webhook_id: d.webhookId,
    webhook_name: d.webhook?.name,
    sync_run_id: d.syncRunId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    next_attempt_at: fromDb(d.nextAttemptAt),
    response_status: d.responseStatus,
    response_body: includePayload ? d.responseBody : d.responseBody?.slice(0, 200) ?? null,
    error: d.error,
    duration_ms: d.durationMs,
    created_at: fromDb(d.createdAt),
    delivered_at: fromDb(d.deliveredAt),
    ...(includePayload ? { payload: d.payload } : {}),
  };
}

export const webhooksRepo = {
  list: () => prisma.webhook.findMany({ orderBy: { id: 'asc' } }),
  get: (id: number) => prisma.webhook.findUnique({ where: { id } }),

  /** Active webhooks subscribed to an event. */
  async subscribedTo(event: WebhookEvent) {
    const all = await prisma.webhook.findMany({ where: { isActive: true } });
    return all.filter((w) => eventsOf(w).includes(event));
  },

  create(input: { name: string; url: string; events: string[]; secret: string; is_active: boolean }) {
    const now = dbNow();
    return prisma.webhook.create({
      data: { name: input.name, url: input.url, events: input.events, secret: input.secret, isActive: input.is_active, createdAt: now, updatedAt: now },
    });
  },

  update(id: number, input: { name?: string; url?: string; events?: string[]; secret?: string; is_active?: boolean }) {
    return prisma.webhook.update({
      where: { id },
      data: { name: input.name, url: input.url, events: input.events, secret: input.secret, isActive: input.is_active, updatedAt: dbNow() },
    });
  },

  remove: (id: number) => prisma.webhook.delete({ where: { id } }),

  /** Stats for the list page: deliveries in the last 24h by status. */
  async stats() {
    const since = new Date(dbNow().getTime() - 24 * 3600_000);
    const rows = await prisma.webhookDelivery.groupBy({
      by: ['webhookId', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const out = new Map<number, { success: number; failed: number; pending: number }>();
    for (const r of rows) {
      const s = out.get(r.webhookId) ?? { success: 0, failed: 0, pending: 0 };
      s[r.status] = r._count._all;
      out.set(r.webhookId, s);
    }
    return out;
  },

  // ---- Deliveries ----
  createDeliveries(rows: { webhookId: number; event: string; payload: Prisma.InputJsonValue; syncRunId?: number | null }[]) {
    const now = dbNow();
    return prisma.webhookDelivery.createMany({
      data: rows.map((r) => ({ ...r, syncRunId: r.syncRunId ?? null, status: 'pending' as const, nextAttemptAt: now, createdAt: now })),
    });
  },

  createDelivery(row: { webhookId: number; event: string; payload: Prisma.InputJsonValue }) {
    const now = dbNow();
    return prisma.webhookDelivery.create({ data: { ...row, status: 'pending', nextAttemptAt: now, createdAt: now } });
  },

  /** Pending deliveries whose time has come, oldest first. */
  due: (limit: number) =>
    prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: dbNow() } },
      orderBy: { id: 'asc' },
      take: limit,
      include: { webhook: true },
    }),

  getDelivery: (id: number) => prisma.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } }),

  async saveAttempt(
    d: { id: number; webhookId: number },
    result: { ok: boolean; final: boolean; attempts: number; nextAttemptAt: Date | null; responseStatus: number | null; responseBody: string | null; error: string | null; durationMs: number },
  ) {
    const now = dbNow();
    const status = result.ok ? 'success' : result.final ? 'failed' : 'pending';
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status,
          attempts: result.attempts,
          nextAttemptAt: result.ok || result.final ? null : result.nextAttemptAt,
          responseStatus: result.responseStatus,
          responseBody: result.responseBody,
          error: result.error,
          durationMs: result.durationMs,
          deliveredAt: result.ok ? now : null,
        },
      }),
      prisma.webhook.update({
        where: { id: d.webhookId },
        data: { lastDeliveryAt: now, lastStatus: result.ok ? 'success' : 'failed' },
      }),
    ]);
  },

  requeue: (id: number) =>
    prisma.webhookDelivery.update({ where: { id }, data: { status: 'pending', nextAttemptAt: dbNow(), error: null } }),

  async deliveries(limit: number, offset: number, filter: { webhookId?: number; status?: 'pending' | 'success' | 'failed' }) {
    const where = { webhookId: filter.webhookId, status: filter.status };
    const [rows, count] = await Promise.all([
      prisma.webhookDelivery.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset, include: { webhook: { select: { name: true } } } }),
      prisma.webhookDelivery.count({ where }),
    ]);
    return { count, data: rows.map((d) => deliveryToJson(d)) };
  },

  /** Successful deliveries are kept 30 days, failed ones 90 days. */
  async prune() {
    const now = dbNow().getTime();
    const [a, b] = await Promise.all([
      prisma.webhookDelivery.deleteMany({ where: { status: 'success', createdAt: { lt: new Date(now - 30 * 86400_000) } } }),
      prisma.webhookDelivery.deleteMany({ where: { status: 'failed', createdAt: { lt: new Date(now - 90 * 86400_000) } } }),
    ]);
    return a.count + b.count;
  },
};
