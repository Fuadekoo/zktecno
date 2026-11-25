import type { Role } from '../repositories/users.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; username: string; role: Role };
    }
  }
}

export {};
