import type { Request, Response } from 'express';
import { BioTimeError, biotime } from '../biotime/client.js';
import { config } from '../config.js';
import { auditRepo } from '../repositories/audit.js';
import { HttpError, pagination, parseId, pickQuery } from '../utils/http.js';

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
  /** Read from the database instead when BioTime is off (BIOTIME_ENABLED=false). Without it, reads return nothing. */
  local?: {
    list: (filters: Record<string, string>, page: number, pageSize: number) => Promise<{ count: number; hasNext: boolean; hasPrevious: boolean; data: Rec[] }>;
    get: (id: number) => Promise<Rec | null>;
  };
}

const READ_ONLY = 'BioTime is turned off (BIOTIME_ENABLED=false), so this is read-only here. Add or change users on the device itself, then run "Sync now".';

/**
 * Controller for a BioTime resource that stays live in BioTime (BioTime is the source of truth
 * for personnel; writes go straight there and the mirror is refreshed afterwards).
 */
export function biotimeResourceController(o: ResourceOptions) {
  const itemPath = (id: number) => `${o.path}${id}/`;
  const off = () => !config.biotime.enabled;
  const empty = { count: 0, hasNext: false, hasPrevious: false, data: [] as Rec[] };

  return {
    async list(req: Request, res: Response) {
      const { page, pageSize } = pagination(req.query);
      const filters = pickQuery(req.query, o.filters);
      if (off()) return void res.json(o.local ? await o.local.list(filters, page, pageSize) : empty);
      res.json(await biotime.list(o.path, { ...filters, page, page_size: pageSize }));
    },

    /** Every record, for dropdowns. */
    async all(req: Request, res: Response) {
      const filters = pickQuery(req.query, o.filters);
      const data = off() ? (o.local ? (await o.local.list(filters, 1, 100_000)).data : []) : await biotime.listAll(o.path, filters);
      res.json({ count: data.length, data });
    },

    async get(req: Request, res: Response) {
      const id = parseId(req.params.id);
      if (off()) {
        const row = o.local ? await o.local.get(id) : null;
        if (!row) throw new HttpError(404, 'Not found');
        return void res.json(row);
      }
      res.json(await biotime.get(itemPath(id)));
    },

    async create(req: Request, res: Response) {
      if (off()) throw new BioTimeError(READ_ONLY, 503);
      const created = await biotime.post<Rec>(o.path, req.body);
      const id = Number(created?.id);
      await auditRepo.log(req, { action: 'create', entity: o.entity, entityId: id, summary: `Created ${o.label({ ...req.body, ...created })}`, details: req.body });
      await o.afterWrite?.('create', id);
      res.status(201).json(created);
    },

    async update(req: Request, res: Response) {
      if (off()) throw new BioTimeError(READ_ONLY, 503);
      const id = parseId(req.params.id);
      const updated = await biotime.patch<Rec>(itemPath(id), req.body);
      await auditRepo.log(req, { action: 'update', entity: o.entity, entityId: id, summary: `Updated ${o.label({ ...req.body, ...updated })}`, details: req.body });
      await o.afterWrite?.('update', id);
      res.json(updated);
    },

    async remove(req: Request, res: Response) {
      if (off()) throw new BioTimeError(READ_ONLY, 503);
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
