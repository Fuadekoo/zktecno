import type { Request, Response } from 'express';
import { config } from '../config.js';
import { cookieOptions, signSession } from '../middleware/auth.js';
import { auditRepo } from '../repositories/audit.js';
import { usersRepo, toPublic } from '../repositories/users.js';
import { authService } from '../services/auth.service.js';
import { HttpError } from '../utils/http.js';

export const authController = {
  async login(req: Request, res: Response) {
    const { username, password } = req.body as { username: string; password: string };
    try {
      const user = await authService.login(username, password);
      const token = signSession(user);
      res.cookie(config.app.cookieName, token, cookieOptions());
      await auditRepo.log(req, { action: 'login', entity: 'session', entityId: user.id, username: user.username, summary: 'Signed in' });
      res.json({ user, token });
    } catch (err) {
      if (err instanceof HttpError) {
        await auditRepo.log(req, { action: 'login_failed', entity: 'session', username, summary: err.message });
      }
      throw err;
    }
  },

  logout(_req: Request, res: Response) {
    const { maxAge: _maxAge, ...opts } = cookieOptions();
    res.clearCookie(config.app.cookieName, opts);
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    const user = await usersRepo.findById(req.user!.id);
    res.json({ user: toPublic(user!) });
  },

  /** Edit your own profile (display name). Role and active state stay admin-only (Users page). */
  async updateMe(req: Request, res: Response) {
    const { full_name } = req.body as { full_name: string };
    await usersRepo.update(req.user!.id, { full_name: full_name || null });
    const user = (await usersRepo.findById(req.user!.id))!;
    await auditRepo.log(req, { action: 'update', entity: 'user', entityId: req.user!.id, summary: 'Updated own profile' });
    res.json({ user: toPublic(user) });
  },

  async changePassword(req: Request, res: Response) {
    const { current_password, new_password } = req.body as { current_password: string; new_password: string };
    await authService.changePassword(req.user!.id, current_password, new_password);
    await auditRepo.log(req, { action: 'update', entity: 'user', entityId: req.user!.id, summary: 'Changed own password' });
    res.status(204).end();
  },
};
