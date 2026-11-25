import { config } from '../config.js';
import { usersRepo, toPublic, type Role } from '../repositories/users.js';
import { HttpError } from '../utils/http.js';
import { fakeVerify, verifyPassword } from '../utils/password.js';

export const authService = {
  /** Returns the user on success; throws 401 with a generic message otherwise. */
  async login(username: string, password: string) {
    const user = await usersRepo.findByUsername(username);
    if (!user) {
      await fakeVerify();
      throw new HttpError(401, 'Wrong username or password');
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Wrong username or password');
    if (!user.isActive) throw new HttpError(403, 'This account is disabled. Ask an administrator.');
    await usersRepo.touchLogin(user.id);
    return toPublic(user);
  },

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await usersRepo.findById(userId);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect', { current_password: 'Incorrect password' });
    }
    await usersRepo.update(userId, { password: newPassword });
  },

  /** First start: create the admin from ADMIN_USERNAME / ADMIN_PASSWORD so someone can sign in. */
  async seedAdminIfEmpty() {
    if ((await usersRepo.count()) > 0) return false;
    const { seedAdminUsername: username, seedAdminPassword: password } = config.app;
    if (password.length < 8) {
      throw new Error('ADMIN_PASSWORD must be at least 8 characters to create the first admin user.');
    }
    await usersRepo.create({ username, password, full_name: 'Administrator', role: 'admin' as Role });
    console.log(`[auth] Created first admin user "${username}" from ADMIN_USERNAME / ADMIN_PASSWORD.`);
    return true;
  },
};
