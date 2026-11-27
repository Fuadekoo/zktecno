/**
 * Live updates for the dashboard over Socket.IO (path /socket.io on the API port).
 *
 * Only signed-in users can connect (same session cookie as the API). The server pushes small "something
 * changed" events; pages then re-read what they show, so the data always comes through the normal API.
 *
 * Events:
 *   punches   { count, live, punches: [...up to 20] }  new punches saved (live = pushed by a device just now)
 *   device    { sn, ip, at }                          a device pushed to this server (at most every 15 s per device)
 *   employees { count, source }                       employees added/changed from a device upload
 *   sync      { job, status }                         a sync run finished
 *   commands  { device_id, ids, status, result? }     device commands sent / finished (pending = retry later)
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { verifySession } from './middleware/auth.js';

let io: Server | null = null;

/** Read one cookie from a Cookie header. */
function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export const realtime = {
  attach(server: HttpServer) {
    io = new Server(server, {
      path: '/socket.io',
      serveClient: false,
      cors: { origin: config.corsOrigin, credentials: true },
    });

    io.use(async (socket, next) => {
      try {
        const token = readCookie(socket.handshake.headers.cookie, config.app.cookieName) ?? (socket.handshake.auth?.token as string | undefined);
        const check = await verifySession(token);
        if (!check.ok) return next(new Error(check.error));
        socket.data.user = check.user;
        next();
      } catch (err) {
        next(new Error((err as Error).message || 'Not signed in'));
      }
    });

    io.on('connection', (socket) => {
      void socket.join('users');
    });
    console.log('[realtime] Live updates on /socket.io');
  },

  emit(event: 'punches' | 'device' | 'employees' | 'sync' | 'commands' | 'branding', payload: object) {
    io?.to('users').emit(event, payload);
  },

  close() {
    void io?.close();
    io = null;
  },
};

// A device polls every few seconds: tell the dashboard at most every 15 s per device.
const lastDeviceEvent = new Map<string, number>();
export function emitDeviceSeen(sn: string, ip: string | null, at: string) {
  const now = Date.now();
  if (now - (lastDeviceEvent.get(sn) ?? 0) < 15_000) return;
  lastDeviceEvent.set(sn, now);
  realtime.emit('device', { sn, ip, at });
}
