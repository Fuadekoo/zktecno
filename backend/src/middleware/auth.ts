import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { usersRepo, type Role } from '../repositories/users.js';

interface SessionPayload {
  sub: string;
  username: string;
  role: Role;
}

export function signSession(user: { id: number; username: string; role: Role }) {
  return jwt.sign({ username: user.username, role: user.role }, config.app.jwtSecret, {
    subject: String(user.id),
    expiresIn: `${config.app.sessionHours}h`,
  });
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.app.cookieSecure,
    path: '/',
    maxAge: config.app.sessionHours * 60 * 60 * 1000,
  };
}

/**
 * Accepts the session cookie (browser) or "Authorization: Bearer <token>" (scripts).
 * The user is re-read from the database so a deactivated or deleted account loses access immediately.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token: string | undefined = req.cookies?.[config.app.cookieName] ?? bearer;
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let payload: SessionPayload;
  try {
    payload = jwt.verify(token, config.app.jwtSecret) as SessionPayload;
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const user = await usersRepo.findById(Number(payload.sub));
  if (!user || !user.isActive) return res.status(401).json({ error: 'Account is disabled or no longer exists' });
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');

/** Viewers may read anything; only admins may change data. */
export function adminForWrites(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return requireAdmin(req, res, next);
}
