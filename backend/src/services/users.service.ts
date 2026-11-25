import { usersRepo, toPublic, type Role } from '../repositories/users.js';
import { HttpError } from '../utils/http.js';

/** Rules that keep at least one working admin account. */
export const usersService = {
  list: () => usersRepo.list(),

  async create(input: { username: string; password: string; full_name?: string | null; role: Role }) {
    if (await usersRepo.findByUsername(input.username)) {
      throw new HttpError(409, 'Username is already taken', { username: 'Already taken' });
    }
    const id = await usersRepo.create(input);
    const user = await usersRepo.findById(id);
    return toPublic(user!);
  },

  async update(actorId: number, id: number, input: { full_name?: string | null; role?: Role; is_active?: boolean; password?: string }) {
    const user = await usersRepo.findById(id);
    if (!user) throw new HttpError(404, 'User not found');

    const losesAdmin = user.role === 'admin' && user.isActive && (input.role === 'viewer' || input.is_active === false);
    if (losesAdmin && (await usersRepo.countActiveAdmins(id)) === 0) {
      throw new HttpError(400, 'There must be at least one active administrator');
    }
    if (actorId === id && input.is_active === false) throw new HttpError(400, 'You cannot disable your own account');

    await usersRepo.update(id, input);
    return toPublic((await usersRepo.findById(id))!);
  },

  async remove(actorId: number, id: number) {
    const user = await usersRepo.findById(id);
    if (!user) throw new HttpError(404, 'User not found');
    if (actorId === id) throw new HttpError(400, 'You cannot delete your own account');
    if (user.role === 'admin' && user.isActive && (await usersRepo.countActiveAdmins(id)) === 0) {
      throw new HttpError(400, 'There must be at least one active administrator');
    }
    await usersRepo.remove(id);
    return user;
  },
};
