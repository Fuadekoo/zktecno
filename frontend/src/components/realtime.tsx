'use client';

/**
 * Live updates from the backend over Socket.IO (same origin, path /socket.io).
 * The server sends small "something changed" events; pages re-read their data quietly (no spinner).
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useI18n } from '@/lib/i18n';
import { useToast } from './ui';

export interface LivePunch {
  id: number;
  emp_code: string;
  employee_name: string | null;
  punch_time: string;
  punch_state_label: string | null;
  verify_type_label: string | null;
  terminal_sn: string | null;
  terminal_alias: string | null;
}

export interface LiveEvents {
  punches: { count: number; live: boolean; punches: LivePunch[] };
  device: { sn: string; ip: string | null; at: string };
  employees: { count: number; source: string };
  sync: { job: string; status: 'success' | 'failed'; created?: number };
  commands: { device_id: number; ids: number[]; status: 'pending' | 'sent' | 'success' | 'failed'; result?: string };
  branding: object;
}
export type LiveEvent = keyof LiveEvents;

type Status = 'connecting' | 'live' | 'offline';

const RealtimeContext = createContext<{ socket: Socket | null; status: Status }>({ socket: null, status: 'offline' });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const s = io({ path: '/socket.io', withCredentials: true, reconnectionDelayMax: 10_000 });
    s.on('connect', () => setStatus('live'));
    s.on('disconnect', () => setStatus('offline'));
    s.on('connect_error', () => setStatus('offline'));

    // A short note for punches that just happened at a device (not for big sync imports)
    s.on('punches', (e: LiveEvents['punches']) => {
      if (!e.live || !e.count) return;
      if (e.count === 1 && e.punches[0]) {
        const p = e.punches[0];
        const who = p.employee_name ? `${p.employee_name} (${p.emp_code})` : p.emp_code;
        const where = p.terminal_alias || p.terminal_sn;
        const msg = tRef.current('toast.punched', { who, state: (p.punch_state_label ?? '').toLowerCase(), time: p.punch_time.slice(11, 16) });
        toastRef.current(where ? `${msg} · ${where}` : msg);
      } else toastRef.current(tRef.current('toast.newPunches', { n: e.count }));
    });

    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, []);

  return <RealtimeContext.Provider value={{ socket, status }}>{children}</RealtimeContext.Provider>;
}

export const useRealtimeStatus = () => useContext(RealtimeContext).status;

/** Call `handler` whenever one of `events` arrives. */
export function useLive<E extends LiveEvent>(events: E | E[], handler: (payload: LiveEvents[E], event: E) => void) {
  const { socket } = useContext(RealtimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  const list = (Array.isArray(events) ? events : [events]).join(',');

  useEffect(() => {
    if (!socket) return;
    const names = list.split(',') as E[];
    const fns = names.map((name) => [name, (p: LiveEvents[E]) => ref.current(p, name)] as const);
    for (const [name, fn] of fns) socket.on(name as string, fn);
    return () => {
      for (const [name, fn] of fns) socket.off(name as string, fn);
    };
  }, [socket, list]);
}

/**
 * Quietly re-read a page's data when one of `events` arrives. Bursts are merged (one reload per `waitMs`).
 * Also re-reads after the connection comes back, to catch anything missed while offline.
 */
export function useLiveRefresh(events: LiveEvent | LiveEvent[], refresh: () => void, waitMs = 800) {
  const { socket } = useContext(RealtimeContext);
  const ref = useRef(refresh);
  ref.current = refresh;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      ref.current();
    }, waitMs);
  };

  useLive(events, schedule);

  // Reconnected after a drop: something may have changed meanwhile
  useEffect(() => {
    if (!socket) return;
    let dropped = false;
    const onDisconnect = () => {
      dropped = true;
    };
    const onConnect = () => {
      if (!dropped) return;
      dropped = false;
      schedule();
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
}

/** "Live" dot for the sidebar. */
export function LiveBadge() {
  const status = useRealtimeStatus();
  const { t } = useI18n();
  const label = t(status === 'live' ? 'live.live' : status === 'connecting' ? 'live.connecting' : 'live.offline');
  const tip = t(status === 'live' ? 'live.tip.live' : status === 'connecting' ? 'live.tip.connecting' : 'live.tip.offline');
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500" title={tip}>
      <span className="relative flex h-2 w-2">
        {status === 'live' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${status === 'live' ? 'bg-brand-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-300'}`} />
      </span>
      {label}
    </span>
  );
}
