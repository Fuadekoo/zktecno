/**
 * Starts Next.js on the port and address set in frontend/.env.
 * (Next.js can't read its own port from .env: it opens the port before loading that file.)
 *
 *   node scripts/next.mjs dev     -> next dev   -H $HOST -p $PORT
 *   node scripts/next.mjs start   -> next start -H $HOST -p $PORT
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** KEY=value lines from .env files (real environment variables win). */
for (const name of ['.env', '.env.local']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`frontend/.env: PORT="${process.env.PORT}" is not a valid port (1-65535)`);
  process.exit(1);
}

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
console.log(`[frontend] next ${mode} on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (API: ${process.env.BACKEND_URL || 'http://localhost:4000'})`);
const child = spawn(process.execPath, [nextBin, mode, '-H', host, '-p', String(port)], { stdio: 'inherit', env: process.env, cwd: root });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
