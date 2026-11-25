import type { Request, Response } from 'express';
import { auditRepo } from '../repositories/audit.js';
import { usersService } from '../services/users.service.js';
import { parseId } from '../utils/http.js';

export const usersController = {
  async list(_req: Request, res: Response) {
    res.json({ data: await usersService.list() });
  },

  async create(req: Request, res: Response) {
    const user = await usersService.create(req.body);
    await auditRepo.log(req, { action: 'create', entity: 'user', entityId: user.id, summary: `Created user ${user.username} (${user.role})` });
    res.status(201).json(user);
  },

  async update(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const user = await usersService.update(req.user!.id, id, req.body);
    const changed = Object.keys(req.body).map((k) => (k === 'password' ? 'password reset' : k));
    await auditRepo.log(req, { action: 'update', entity: 'user', entityId: id, summary: `Updated ${user.username}: ${changed.join(', ')}` });
    res.json(user);
  },

  async remove(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const user = await usersService.remove(req.user!.id, id);
    await auditRepo.log(req, { action: 'delete', entity: 'user', entityId: id, summary: `Deleted user ${user.username}` });
    res.status(204).end();
  },
};
