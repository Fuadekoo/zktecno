import type { Request, Response } from 'express';
import { auditRepo } from '../repositories/audit.js';
import { deliveryToJson, WEBHOOK_EVENTS, webhooksRepo, webhookToJson } from '../repositories/webhooks.js';
import { newSecret, WEBHOOK_LIMITS, webhookService } from '../services/webhook.service.js';
import { HttpError, pagination, parseId, str } from '../utils/http.js';

async function findOr404(id: number) {
  const hook = await webhooksRepo.get(id);
  if (!hook) throw new HttpError(404, 'Webhook not found');
  return hook;
}

export const webhooksController = {
  async list(_req: Request, res: Response) {
    const [hooks, stats] = await Promise.all([webhooksRepo.list(), webhooksRepo.stats()]);
    res.json({
      events: WEBHOOK_EVENTS,
      limits: { max_attempts: WEBHOOK_LIMITS.MAX_ATTEMPTS, punches_per_delivery: WEBHOOK_LIMITS.PUNCHES_PER_DELIVERY },
      data: hooks.map((h) => ({ ...webhookToJson(h), last_24h: stats.get(h.id) ?? { success: 0, failed: 0, pending: 0 } })),
    });
  },

  async get(req: Request, res: Response) {
    res.json(webhookToJson(await findOr404(parseId(req.params.id)), { revealSecret: true }));
  },

  async create(req: Request, res: Response) {
    const body = req.body as { name: string; url: string; events: string[]; is_active: boolean };
    const hook = await webhooksRepo.create({ ...body, secret: newSecret() });
    await auditRepo.log(req, { action: 'create', entity: 'webhook', entityId: hook.id, summary: `Created webhook ${hook.name} → ${hook.url}` });
    res.status(201).json(webhookToJson(hook, { revealSecret: true }));
  },

  async update(req: Request, res: Response) {
    const id = parseId(req.params.id);
    await findOr404(id);
    const { rotate_secret, ...body } = req.body as { name?: string; url?: string; events?: string[]; is_active?: boolean; rotate_secret?: boolean };
    const hook = await webhooksRepo.update(id, { ...body, secret: rotate_secret ? newSecret() : undefined });
    const changed = Object.keys(req.body).map((k) => (k === 'rotate_secret' ? 'new secret' : k));
    await auditRepo.log(req, { action: 'update', entity: 'webhook', entityId: id, summary: `Updated webhook ${hook.name}: ${changed.join(', ')}` });
    res.json(webhookToJson(hook, { revealSecret: true }));
  },

  async remove(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const hook = await findOr404(id);
    await webhooksRepo.remove(id);
    await auditRepo.log(req, { action: 'delete', entity: 'webhook', entityId: id, summary: `Deleted webhook ${hook.name}` });
    res.status(204).end();
  },

  /** Sends a test event immediately and returns the delivery result. */
  async test(req: Request, res: Response) {
    const id = parseId(req.params.id);
    await findOr404(id);
    const delivery = await webhookService.sendTest(id);
    res.json(delivery ? deliveryToJson(delivery, { includePayload: true }) : null);
  },

  async deliveries(req: Request, res: Response) {
    const { pageSize, offset } = pagination(req.query, 25);
    const status = str(req.query.status);
    const webhookId = Number(str(req.query.webhook_id));
    res.json(
      await webhooksRepo.deliveries(pageSize, offset, {
        webhookId: Number.isInteger(webhookId) && webhookId > 0 ? webhookId : undefined,
        status: status === 'pending' || status === 'success' || status === 'failed' ? status : undefined,
      }),
    );
  },

  async delivery(req: Request, res: Response) {
    const d = await webhooksRepo.getDelivery(parseId(req.params.id));
    if (!d) throw new HttpError(404, 'Delivery not found');
    res.json(deliveryToJson(d, { includePayload: true }));
  },

  async redeliver(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (!(await webhooksRepo.getDelivery(id))) throw new HttpError(404, 'Delivery not found');
    const d = await webhookService.redeliver(id);
    await auditRepo.log(req, { action: 'redeliver', entity: 'webhook_delivery', entityId: id, summary: `Re-sent webhook delivery #${id}: ${d?.status}` });
    res.json(d ? deliveryToJson(d, { includePayload: true }) : null);
  },
};
