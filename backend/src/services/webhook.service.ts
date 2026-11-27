import crypto from 'node:crypto';
import type { Prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { SyncRun } from '../generated/prisma/client.js';
import type { Punch } from '../repositories/punches.js';
import { runToJson } from '../repositories/syncRuns.js';
import { webhooksRepo, type WebhookEvent } from '../repositories/webhooks.js';
import { punchesRepo } from '../repositories/punches.js';
import { realtime } from '../realtime.js';
import { localDate } from '../utils/http.js';

/** Punches per request: large syncs are split so no single POST is huge. */
const PUNCHES_PER_DELIVERY = 100;
/** Wait before retry N (after attempt N fails). After the last one the delivery is marked failed. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
const WORKER_INTERVAL_MS = 10_000;
const BATCH = 20;

export const newSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;

/** Receivers verify with: HMAC_SHA256(secret, `${timestamp}.${rawBody}`) === signature. */
export function sign(secret: string, timestamp: string, body: string) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function punchPayload(p: Punch) {
  return {
    id: p.id,
    emp_code: p.emp_code,
    employee_name: p.employee_name,
    department: p.department_name,
    punch_time: p.punch_time,
    punch_state: p.punch_state,
    punch_state_label: p.punch_state_label,
    verify_type: p.verify_type,
    verify_type_label: p.verify_type_label,
    terminal_sn: p.terminal_sn,
    terminal_alias: p.terminal_alias,
    area_alias: p.area_alias,
  };
}

class WebhookService {
  private timer: NodeJS.Timeout | null = null;
  private working = false;

  start() {
    this.timer = setInterval(() => void this.processDue(), WORKER_INTERVAL_MS);
    this.timer.unref();
    void this.processDue();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Queue "punch.created" deliveries for every subscribed webhook (or only `onlyWebhookId`, for sending
   * past punches to one receiver). Returns deliveries created.
   */
  async queuePunches(punches: Punch[], syncRunId: number | null, onlyWebhookId?: number) {
    if (!punches.length) return 0;
    // Dashboard live update (not for a manual resend to one webhook)
    if (onlyWebhookId === undefined) realtime.emit('punches', { count: punches.length, live: syncRunId === null, punches: punches.slice(-20).map(punchPayload) });
    const hooks = (await webhooksRepo.subscribedTo('punch.created')).filter((h) => onlyWebhookId === undefined || h.id === onlyWebhookId);
    if (!hooks.length) return 0;
    const rows: { webhookId: number; event: string; payload: Prisma.InputJsonValue; syncRunId: number | null }[] = [];
    const total = Math.ceil(punches.length / PUNCHES_PER_DELIVERY);
    for (let i = 0; i < punches.length; i += PUNCHES_PER_DELIVERY) {
      const chunk = punches.slice(i, i + PUNCHES_PER_DELIVERY);
      const payload = {
        event: 'punch.created',
        created_at: fromDb(dbNow()),
        sync_run_id: syncRunId,
        batch: { index: i / PUNCHES_PER_DELIVERY + 1, total },
        data: { count: chunk.length, punches: chunk.map(punchPayload) },
      };
      for (const h of hooks) rows.push({ webhookId: h.id, event: 'punch.created', payload, syncRunId });
    }
    await webhooksRepo.createDeliveries(rows);
    this.kick();
    return rows.length;
  }

  /**
   * Send punches already in the database to one webhook: today (days = 1) or the last `days` days.
   * They go out through the normal queue, in batches, with retries.
   */
  async sendPastPunches(webhookId: number, days: number) {
    const start = new Date();
    start.setDate(start.getDate() - (Math.max(1, days) - 1));
    const punches = await punchesRepo.since(`${localDate(start)} 00:00:00`);
    const deliveries = await this.queuePunches(punches, null, webhookId);
    return { punches: punches.length, deliveries };
  }

  /** Queue "sync.completed" / "sync.failed" for a finished punch sync run. */
  async queueSyncResult(run: SyncRun) {
    const event: WebhookEvent = run.status === 'success' ? 'sync.completed' : 'sync.failed';
    const hooks = await webhooksRepo.subscribedTo(event);
    if (!hooks.length) return 0;
    const payload = { event, created_at: fromDb(dbNow()), sync_run_id: run.id, data: runToJson(run) };
    await webhooksRepo.createDeliveries(hooks.map((h) => ({ webhookId: h.id, event, payload, syncRunId: run.id })));
    this.kick();
    return hooks.length;
  }

  /** Send a test event right now and return the outcome. */
  async sendTest(webhookId: number) {
    const delivery = await webhooksRepo.createDelivery({
      webhookId,
      event: 'webhook.test',
      payload: {
        event: 'webhook.test',
        created_at: fromDb(dbNow()),
        data: { message: 'Test delivery from the ZKTeco attendance dashboard. If you can read this, the webhook works.' },
      },
    });
    return this.deliverById(delivery.id);
  }

  /** Re-send a delivery (e.g. a failed one after fixing the receiver). */
  async redeliver(deliveryId: number) {
    await webhooksRepo.requeue(deliveryId);
    return this.deliverById(deliveryId);
  }

  private kick() {
    setImmediate(() => void this.processDue());
  }

  /** Sends everything that is due. Only one pass runs at a time. */
  async processDue() {
    if (this.working) return;
    this.working = true;
    try {
      for (;;) {
        const due = await webhooksRepo.due(BATCH);
        if (!due.length) break;
        // Deliveries of different webhooks go out in parallel; one slow receiver doesn't block the rest.
        await Promise.all(due.map((d) => this.attempt(d, d.webhook)));
      }
    } catch (err) {
      console.error('[webhooks] Worker error:', (err as Error).message);
    } finally {
      this.working = false;
    }
  }

  private async deliverById(id: number) {
    const d = await webhooksRepo.getDelivery(id);
    if (!d) throw new Error('Delivery not found');
    await this.attempt(d, d.webhook);
    return webhooksRepo.getDelivery(id);
  }

  private async attempt(
    d: { id: number; webhookId: number; event: string; payload: Prisma.JsonValue; attempts: number },
    hook: { url: string; secret: string; isActive: boolean },
  ) {
    const attempts = d.attempts + 1;
    const body = JSON.stringify({ delivery_id: d.id, ...(d.payload as object) });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const started = Date.now();
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ZKTeco-Attendance-Webhook/1.0',
          'X-Webhook-Event': d.event,
          'X-Webhook-Delivery': String(d.id),
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature': sign(hook.secret, timestamp, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      responseStatus = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 2000) || null;
      if (!res.ok) error = `Receiver answered HTTP ${res.status}`;
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      error =
        e.name === 'TimeoutError'
          ? `No response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : `Could not connect: ${e.cause?.code ?? e.message}`;
    }

    const ok = error === null;
    const final = !ok && attempts >= MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[attempts - 1] ?? 0;
    await webhooksRepo.saveAttempt(d, {
      ok,
      final,
      attempts,
      nextAttemptAt: ok || final ? null : new Date(dbNow().getTime() + delay),
      responseStatus,
      responseBody,
      error: error && !ok && !final ? `${error} (retry ${attempts}/${MAX_ATTEMPTS - 1} in ${Math.round(delay / 60000)} min)` : error,
      durationMs: Date.now() - started,
    });
    if (!ok) console.warn(`[webhooks] Delivery ${d.id} to ${hook.url} failed (attempt ${attempts}): ${error}`);
  }
}

export const webhookService = new WebhookService();
export const WEBHOOK_LIMITS = { MAX_ATTEMPTS, RETRY_DELAYS_MS, PUNCHES_PER_DELIVERY, REQUEST_TIMEOUT_MS };
