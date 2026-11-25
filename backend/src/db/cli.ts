/**
 * Maintenance commands:
 *   npm run user:reset-password -- <username> <new-password>
 * (Tables are managed by Prisma: `npm run db:deploy`.)
 */
import { usersRepo } from '../repositories/users.js';
import { connectDatabase, describeDbError, disconnectDatabase } from './prisma.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    await connectDatabase();
  } catch (err) {
    console.error(describeDbError(err));
    process.exit(1);
  }

  if (command === 'reset-password') {
    const [username, password] = args;
    if (!username || !password || password.length < 8) {
      console.error('Usage: npm run user:reset-password -- <username> <new-password (8+ chars)>');
      process.exitCode = 1;
    } else {
      const user = await usersRepo.findByUsername(username);
      if (user) {
        await usersRepo.update(user.id, { password, is_active: true });
        console.log(`Password reset and account enabled for "${username}".`);
      } else {
        await usersRepo.create({ username, password, role: 'admin', full_name: null });
        console.log(`User "${username}" did not exist, so it was created as an admin.`);
      }
    }
  } else {
    console.error('Commands: reset-password <username> <password>');
    process.exitCode = 1;
  }
  await disconnectDatabase();
}

void main();
