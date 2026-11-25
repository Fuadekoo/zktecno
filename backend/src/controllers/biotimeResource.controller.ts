import type { Request, Response } from 'express';
import { biotime } from '../biotime/client.js';
import { auditRepo } from '../repositories/audit.js';
import { pagination, parseId, pickQuery } from '../utils/http.js';

type Rec = Record<string, unknown> & { id?: number };

export interface ResourceOptions {
  /** BioTime path, e.g. "/personnel/api/departments/" */
  path: string;
  /** Audit log entity name */
  entity: string;
  /** Query params forwarded to BioTime on list */
  filters: readonly string[];
  /** Human label for audit messages */
  label: (r: Rec) => string;
  /** Runs after a successful create/update/delete (e.g. refresh the database mirror) */
  afterWrite?: (action: 'create' | 'update' | 'delete', id: number) => void | Promise<void>;
}

/**
 * Controller for a BioTime resource that stays live in BioTime (BioTime is the source of truth
 * for personnel; writes go straight there and the mirror is refreshed afterwards).
 */
export function biotimeResourceController(o: ResourceOptions) {
  const itemPath = (id: number) => `${o.path}${id}/`;

  return {
    async list(req: Request, res: Response) {
      const { page, pageSize } = pagination(req.query);
      res.json(await biotime.list(o.path, { ...pickQuery(req.query, o.filters), page, page_size: pageSize }));
    },

    /** Every record, for dropdowns. */
    async all(req: Request, res: Response) {
      const data = await biotime.listAll(o.path, pickQuery(req.query, o.filters));
      res.json({ count: data.length, data });
    },

    async get(req: Request, res: Response) {
      res.json(await biotime.get(itemPath(parseId(req.params.id))));
    },

    async create(req: Request, res: Response) {
      const created = await biotime.post<Rec>(o.path, req.body);
      const id = Number(created?.id);
      await auditRepo.log(req, { action: 'create', entity: o.entity, entityId: id, summary: `Created ${o.label({ ...req.body, ...created })}`, details: req.body });
      await o.afterWrite?.('create', id);
      res.status(201).json(created);
    },

    async update(req: Request, res: Response) {
      const id = parseId(req.params.id);
      const updated = await biotime.patch<Rec>(itemPath(id), req.body);
      await auditRepo.log(req, { action: 'update', entity: o.entity, entityId: id, summary: `Updated ${o.label({ ...req.body, ...updated })}`, details: req.body });
      await o.afterWrite?.('update', id);
      res.json(updated);
    },

    async remove(req: Request, res: Response) {
      const id = parseId(req.params.id);
      // Read first so the audit log can say what was deleted.
      const before = await biotime.get<Rec>(itemPath(id)).catch(() => ({ id }) as Rec);
      await biotime.delete(itemPath(id));
      await auditRepo.log(req, { action: 'delete', entity: o.entity, entityId: id, summary: `Deleted ${o.label(before)}` });
      await o.afterWrite?.('delete', id);
      res.status(204).end();
    },
  };
}
