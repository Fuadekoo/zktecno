import { prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { Role, User } from '../generated/prisma/client.js';
import { hashPassword } from '../utils/password.js';

export type { Role };

/** Shape sent to the frontend (never includes the password hash). */
export interface PublicUser {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toPublic(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    full_name: u.fullName,
    role: u.role,
    is_active: u.isActive,
    last_login_at: fromDb(u.lastLoginAt),
    created_at: fromDb(u.createdAt),
    updated_at: fromDb(u.updatedAt),
  };
}

export const usersRepo = {
  async list(): Promise<PublicUser[]> {
    return (await prisma.user.findMany({ orderBy: { username: 'asc' } })).map(toPublic);
  },

  findById: (id: number) => prisma.user.findUnique({ where: { id } }),
  findByUsername: (username: string) => prisma.user.findUnique({ where: { username } }),
  count: () => prisma.user.count(),

  countActiveAdmins(excludeId?: number) {
    return prisma.user.count({ where: { role: 'admin', isActive: true, id: { not: excludeId ?? 0 } } });
  },

  async create(input: { username: string; password: string; full_name?: string | null; role: Role }) {
    const now = dbNow();
    const user = await prisma.user.create({
      data: {
        username: input.username,
        fullName: input.full_name ?? null,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        createdAt: now,
        updatedAt: now,
      },
    });
    return user.id;
  },

  async update(id: number, input: { full_name?: string | null; role?: Role; is_active?: boolean; password?: string }) {
    await prisma.user.update({
      where: { id },
      data: {
        fullName: input.full_name,
        role: input.role,
        isActive: input.is_active,
        passwordHash: input.password === undefined ? undefined : await hashPassword(input.password),
        updatedAt: dbNow(),
      },
    });
  },

  touchLogin: (id: number) => prisma.user.update({ where: { id }, data: { lastLoginAt: dbNow() } }),
  remove: (id: number) => prisma.user.delete({ where: { id } }),
};
