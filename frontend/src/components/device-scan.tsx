'use client';

/**
 * Network scan for ZKTeco devices: the streaming scan hook and the radar that shows it.
 * Used by the Nearby Devices page and the "Scan network" window in Settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface FoundDevice {
  ip: string;
  port: number;
  /** How it was found: answered on the network, and/or is pushing to this server */
  via: ('tcp' | 'udp' | 'push')[];
  serial_number: string | null;
  model: string | null;
  firmware: string | null;
  user_count: number | null;
  log_count: number | null;
  /** Answered the port scan but its details couldn't be read (busy, or Comm Key set) */
  error: string | null;
  last_push_at: string | null;
  /** Already in the device list */
  added: { id: number; name: string } | null;
}

export type ScanPhase = 'idle' | 'scanning' | 'paused' | 'done' | 'error';

export const deviceKey = (f: FoundDevice) => `${f.ip}|${f.serial_number ?? ''}`;
export const isReachable = (f: FoundDevice) => f.via.includes('tcp') || f.via.includes('udp');

/**
 * Runs the streaming scan (POST /api/settings/devices/scan?stream=1). Devices are added as they are found.
 * Closing the page (unmount) stops the scan on the server too.
 */
export function useDeviceScan() {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, ip: '' });
  const [networks, setNetworks] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ scanned: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Start a scan. `fresh` clears what was found before; otherwise new finds are added to the list. */
  const scan = useCallback(async (fresh: boolean) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (fresh) setDevices([]);
    setPhase('scanning');
    setError(null);
    setSummary(null);
    setProgress({ done: 0, total: 0, ip: '' });
    try {
      const res = await fetch('/api/settings/devices/scan?stream=1', { method: 'POST', credentials: 'same-origin', signal: ctrl.signal });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Scan failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'start') {
            setNetworks(ev.networks);
            setProgress({ done: 0, total: ev.total * 2, ip: '' });
          } else if (ev.type === 'progress') setProgress({ done: ev.done, total: ev.total, ip: ev.ip ?? '' });
          else if (ev.type === 'device') {
            const d = ev.device as FoundDevice;
            const key = deviceKey(d);
            // Found again on a rescan: refresh its details, keep a connection made on this page
            setDevices((list) =>
              list.some((x) => deviceKey(x) === key) ? list.map((x) => (deviceKey(x) === key ? { ...d, added: d.added ?? x.added } : x)) : [...list, d],
            );
          } else if (ev.type === 'done') {
            setSummary({ scanned: ev.scanned, ms: ev.ms });
            setPhase('done');
          } else if (ev.type === 'error') throw new Error(ev.message);
        }
      }
      setPhase((ph) => (ph === 'scanning' ? 'done' : ph));
    } catch (err) {
      if (ctrl.signal.aborted) return; // paused or left the page
      setError(err instanceof Error ? err.message : 'Scan failed');
      setPhase('error');
    }
  }, []);

  const pause = useCallback(() => {
    abortRef.current?.abort();
    setPhase((ph) => (ph === 'scanning' ? 'paused' : ph));
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Mark a found device as added (after connecting it). */
  const markAdded = useCallback((key: string, added: { id: number; name: string }) => {
    setDevices((list) => list.map((d) => (deviceKey(d) === key ? { ...d, added } : d)));
  }, []);

  // Stop the server-side scan when the component goes away
  useEffect(() => () => abortRef.current?.abort(), []);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return { phase, devices, progress, pct, networks, summary, error, scan, pause, stop, markAdded };
}

export type DeviceScan = ReturnType<typeof useDeviceScan>;

/** What a found device reported: serial, firmware, counts, how it was reached. */
export function FoundDeviceDetails({ d }: { d: FoundDevice }) {
  const rows: [string, string | number | null][] = [
    ['Serial number', d.serial_number],
    ['Firmware', d.firmware],
    ['Users', d.user_count],
    ['Punches stored', d.log_count],
    ['Connection', d.via.map((v) => (v === 'push' ? 'pushing here' : v.toUpperCase())).join(' + ')],
  ];
  return (
    <>
      <dl className="space-y-1 text-xs">
        {rows
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className={`truncate text-slate-800 ${k === 'Serial number' ? 'font-mono' : ''}`}>{v}</dd>
            </div>
          ))}
      </dl>
      {d.error && <p className="mt-2 text-[11px] text-amber-700">Found, but its details couldn’t be read ({d.error}). It may be busy, or have a Comm Key set.</p>}
    </>
  );
}

// ---------------------------------------------------------------- radar

/** Where a found device sits on the radar: angle from its address, distance from how it was found. */
function blipPosition(f: FoundDevice, index: number) {
  const seed = f.ip ? Number(f.ip.split('.').pop()) : [...(f.serial_number ?? 'x')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const angle = ((seed * 137.508 + index * 41) % 360) * (Math.PI / 180);
  const ring = isReachable(f) ? 0.38 + (seed % 4) * 0.1 : 0.84; // push-only devices sit on the outer ring
  return { x: 50 + Math.cos(angle) * ring * 50, y: 50 + Math.sin(angle) * ring * 50 };
}

export const RADAR_CSS = `
  @keyframes radar-sweep { to { transform: rotate(360deg); } }
  @keyframes radar-wave { 0% { transform: scale(.12); opacity: .55; } 100% { transform: scale(1); opacity: 0; } }
  @keyframes radar-ping { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(2.4); opacity: 0; } }
  @keyframes radar-pop { 0% { transform: translate(-50%, -50%) scale(0); } 65% { transform: translate(-50%, -50%) scale(1.2); } 100% { transform: translate(-50%, -50%) scale(1); } }
  @keyframes radar-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .radar-sweep { animation: radar-sweep 3s linear infinite; }
  .radar-wave { animation: radar-wave 3s ease-out infinite; }
  .radar-ping { animation: radar-ping 1.6s ease-out infinite; }
  .radar-blip { animation: radar-pop .5s cubic-bezier(.2,.9,.3,1.3) both; }
  .radar-in { animation: radar-in .35s ease-out both; }
  @media (prefers-reduced-motion: reduce) { .radar-sweep, .radar-wave, .radar-ping, .radar-blip, .radar-in { animation: none; } }
`;

/** The radar face: rings, crosshair, degree ticks. */
function RadarFace() {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f6fcf4" />
          <stop offset="70%" stopColor="#eaf6e6" />
          <stop offset="100%" stopColor="#dcefd6" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49.6" fill="url(#radar-bg)" stroke="#b2e2a7" strokeWidth="0.5" />
      {[37.5, 25.5, 13.5].map((r) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#b2e2a7" strokeWidth="0.35" />
      ))}
      {[43.5, 31.5, 19.5].map((r) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#c9eac1" strokeWidth="0.25" strokeDasharray="0.8 1.2" />
      ))}
      <line x1="50" y1="0.6" x2="50" y2="99.4" stroke="#b2e2a7" strokeWidth="0.35" />
      <line x1="0.6" y1="50" x2="99.4" y2="50" stroke="#b2e2a7" strokeWidth="0.35" />
      <line x1="14.9" y1="14.9" x2="85.1" y2="85.1" stroke="#d7f0d1" strokeWidth="0.25" />
      <line x1="85.1" y1="14.9" x2="14.9" y2="85.1" stroke="#d7f0d1" strokeWidth="0.25" />
      {ticks.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const long = deg % 30 === 0;
        const r1 = long ? 46.6 : 47.9;
        return (
          <line
            key={deg}
            x1={50 + Math.sin(a) * r1}
            y1={50 - Math.cos(a) * r1}
            x2={50 + Math.sin(a) * 49.4}
            y2={50 - Math.cos(a) * 49.4}
            stroke={long ? '#8bd27c' : '#b2e2a7'}
            strokeWidth={long ? 0.45 : 0.25}
          />
        );
      })}
    </svg>
  );
}

/** Radar with the found devices, plus status line, progress bar and Pause / Resume / Rescan. */
export function RadarPanel({ scan, selected, onSelect }: { scan: DeviceScan; selected: string | null; onSelect: (key: string) => void }) {
  const { phase, devices, progress, pct, networks, summary } = scan;
  const scanning = phase === 'scanning';

  const headline =
    phase === 'scanning'
      ? 'Searching for nearby devices…'
      : phase === 'paused'
        ? 'Search paused'
        : phase === 'error'
          ? 'Search failed'
          : phase === 'idle'
            ? 'Ready to search'
            : devices.length
              ? `Found ${devices.length} device${devices.length === 1 ? '' : 's'}`
              : 'No devices found';

  return (
    <div className="flex flex-col items-center">
      <style>{RADAR_CSS}</style>
      <div className="relative aspect-square w-full max-w-[23rem] select-none rounded-full shadow-[0_10px_40px_-12px_rgba(61,148,48,0.45)]">
        <RadarFace />

        {/* Sweep: bright leading edge with a fading trail */}
        {scanning && (
          <div className="radar-sweep absolute inset-0 overflow-hidden rounded-full">
            <div
              className="absolute inset-0"
              style={{ background: 'conic-gradient(from 0deg, rgba(61,148,48,0) 0deg, rgba(61,148,48,0) 250deg, rgba(61,148,48,0.06) 300deg, rgba(61,148,48,0.34) 359deg, rgba(61,148,48,0) 360deg)' }}
            />
            <div className="absolute bottom-1/2 left-1/2 h-1/2 w-[2px] -translate-x-1/2 bg-gradient-to-t from-brand-600/20 to-brand-600 shadow-[0_0_8px_rgba(61,148,48,0.8)]" />
          </div>
        )}

        {/* Sonar waves from this PC */}
        {scanning &&
          [0, 1, 2].map((i) => <span key={i} className="radar-wave absolute inset-0 rounded-full border-2 border-brand-400/70" style={{ animationDelay: `${i}s` }} />)}

        {/* This PC */}
        <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg ring-4 ring-white">
            <Icon name="wifi" className="h-6 w-6" />
          </div>
          <span className="mt-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm">This PC</span>
        </div>

        {/* Devices */}
        {devices.map((d, i) => {
          const pos = blipPosition(d, i);
          const key = deviceKey(d);
          const isSel = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className="radar-blip absolute z-20 flex flex-col items-center focus:outline-none"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
              title={[d.model, d.ip, d.serial_number].filter(Boolean).join(' · ')}
              aria-label={`${d.model || 'Device'} ${d.ip}`}
            >
              <span className={`relative flex items-center justify-center transition-transform duration-200 ${isSel ? 'scale-110' : 'hover:scale-105'}`}>
                {!d.added && <span className="radar-ping absolute inset-0 rounded-full bg-brand-400" />}
                <span
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full ring-4 transition-colors ${
                    d.added
                      ? 'bg-slate-500 text-white ring-white shadow-md'
                      : isSel
                        ? 'bg-brand-600 text-white ring-brand-200 shadow-[0_0_0_6px_rgba(61,148,48,0.15),0_0_22px_rgba(61,148,48,0.65)]'
                        : 'bg-white text-brand-700 ring-white shadow-[0_0_18px_rgba(61,148,48,0.45)]'
                  } ${d.error ? 'opacity-75' : ''}`}
                >
                  <Icon name={d.added ? 'check' : 'device'} className="h-5 w-5" />
                </span>
              </span>
              <span className={`mt-1 max-w-[7.5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm ${isSel ? 'bg-brand-600 text-white' : 'bg-white text-slate-700'}`}>
                {d.model || d.ip || d.serial_number}
              </span>
            </button>
          );
        })}
      </div>

      {/* Status, live ticker, controls */}
      <div className="mt-5 w-full max-w-[23rem] text-center">
        <div className="text-base font-semibold text-slate-800">{headline}</div>
        <div className="mt-1 h-4 font-mono text-[11px] text-slate-400">
          {scanning
            ? progress.ip
              ? `Checking ${progress.ip} · ${pct}%`
              : 'Starting…'
            : summary
              ? `Checked ${summary.scanned} addresses in ${(summary.ms / 1000).toFixed(1)} s`
              : phase === 'paused'
                ? `Stopped at ${pct}%`
                : ''}
        </div>
        <div className="mx-auto mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${phase === 'paused' ? 'bg-amber-400' : 'bg-brand-600'}`}
            style={{ width: `${phase === 'done' ? 100 : Math.max(pct, scanning ? 3 : 0)}%` }}
          />
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {scanning ? (
            <button className="btn-secondary min-w-32" onClick={scan.pause}>
              <span className="flex h-4 w-4 items-center justify-center gap-[3px]" aria-hidden="true">
                <span className="h-3 w-[3px] rounded bg-current" />
                <span className="h-3 w-[3px] rounded bg-current" />
              </span>
              Pause
            </button>
          ) : phase === 'paused' ? (
            <button className="btn-secondary min-w-32" onClick={() => scan.scan(false)}>
              <span className="h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-current" aria-hidden="true" />
              Resume
            </button>
          ) : null}
          <button className={`min-w-32 ${scanning ? 'btn-secondary' : 'btn-primary'}`} onClick={() => scan.scan(true)}>
            <Icon name="refresh" className="h-4 w-4" />
            {phase === 'idle' ? 'Search' : 'Rescan'}
          </button>
        </div>
        {networks.length > 0 && <div className="mt-3 text-[11px] text-slate-400">Network: {networks.join(', ')}</div>}
      </div>
    </div>
  );
}
