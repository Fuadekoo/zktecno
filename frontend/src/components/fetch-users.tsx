'use client';

/**
 * "Fetch from device" on the Employees page: ask devices for the people enrolled on them and follow each
 * request live (asked → device has it → done). Users arrive in Employees by themselves (live update).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePoll } from './device-control';
import { Icon } from './icons';
import { useLive } from './realtime';
import { Alert, Modal, Spinner, useToast } from './ui';
import { api, type Paginated } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { CommandStatus, ControlDevice, DeviceCommand } from '@/lib/types';

type Track = { commandId: number; status: CommandStatus; result: string | null; channel: 'push' | 'pull' };
type DevicesResponse = { adms: { enabled: boolean; forwarding: boolean; port: number }; data: ControlDevice[] };

function online(d: ControlDevice) {
  return Boolean(d.push?.polling) || d.mode === 'pull';
}

function StatusBadge({ d }: { d: ControlDevice }) {
  if (!d.enabled) return <span className="badge bg-slate-100 text-slate-500">Disabled</span>;
  if (d.push?.polling) return <span className="badge bg-brand-50 text-brand-700">Online</span>;
  if (d.push) return <span className="badge bg-amber-50 text-amber-700">Last seen {timeAgo(d.push.last_seen)}</span>;
  if (d.mode === 'pull') return <span className="badge bg-sky-50 text-sky-700">Network</span>;
  return <span className="badge bg-slate-100 text-slate-500">Never connected</span>;
}

const STEPS = ['Asked', 'Device got it', 'Done'] as const;
function stepOf(t: Track) {
  if (t.status === 'success') return 3;
  if (t.status === 'sent') return 2;
  return 1;
}

function Progress({ t }: { t: Track }) {
  const failed = t.status === 'failed' || t.status === 'cancelled';
  const step = stepOf(t);
  return (
    <div className="mt-3">
      <ol className="flex items-center gap-1">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = !failed && n <= step;
          const current = !failed && n === step + 1;
          return (
            <li key={label} className="flex flex-1 items-center gap-1">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  done ? 'bg-brand-600 text-white' : failed && n === step + 1 ? 'bg-red-600 text-white' : current ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Icon name="check" className="h-3 w-3" /> : failed && n === step + 1 ? <Icon name="x" className="h-3 w-3" /> : current ? <Spinner className="h-3 w-3" /> : n}
              </span>
              <span className={`truncate text-[11px] ${done ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
              {n < STEPS.length && <span className={`mx-1 h-px flex-1 ${done && n < step ? 'bg-brand-300' : 'bg-slate-200'}`} />}
            </li>
          );
        })}
      </ol>
      <p className={`mt-2 text-xs ${failed ? 'text-red-600' : 'text-slate-500'}`}>
        {failed
          ? t.result || 'The device could not do it.'
          : t.status === 'success'
            ? t.result || 'Done.'
            : t.status === 'sent'
              ? 'The device is sending its users…'
              : t.result
                ? t.result
                : t.channel === 'push'
                  ? 'Waiting for the device to check in (usually within 10 seconds)…'
                  : 'Connecting to the device…'}
      </p>
    </div>
  );
}

export function FetchUsersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const devices = useApi<DevicesResponse>(open ? '/device-control/devices' : null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tracks, setTracks] = useState<Record<number, Track>>({});
  const [received, setReceived] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = devices.data?.data ?? [];
  const usable = (d: ControlDevice) => d.enabled && d.capabilities.query_users.ok;

  // Fresh start each time it opens; pre-select the devices that are online
  useEffect(() => {
    if (!open) return;
    setTracks({});
    setReceived(0);
    setError(null);
  }, [open]);
  useEffect(() => {
    if (open && devices.data) setSelected(new Set(devices.data.data.filter((d) => usable(d) && online(d)).map((d) => d.id)));
  }, [open, devices.data]);

  const started = Object.keys(tracks).length > 0;
  const waiting = Object.values(tracks).some((t) => t.status === 'pending' || t.status === 'sent');
  const finished = started && !waiting;

  // Live progress
  useLive('commands', (e) => {
    setTracks((all) => {
      let changed = false;
      const next = { ...all };
      for (const [deviceId, t] of Object.entries(all)) {
        if (e.ids.includes(t.commandId)) {
          next[Number(deviceId)] = { ...t, status: e.status, result: e.result ?? t.result };
          changed = true;
        }
      }
      return changed ? next : all;
    });
  });
  useLive('employees', (e) => {
    if (started) setReceived((n) => n + e.count);
  });

  // Safety net if live updates are not connected: re-read the commands every 5 s while waiting
  const recheck = useCallback(() => {
    for (const [deviceId, t] of Object.entries(tracks)) {
      if (t.status !== 'pending' && t.status !== 'sent') continue;
      void api<Paginated<DeviceCommand>>('/device-control/commands', { query: { device_id: deviceId, kind: 'query_users', page_size: 5 } })
        .then((r) => {
          const c = r.data.find((x) => x.id === t.commandId);
          if (c) setTracks((all) => ({ ...all, [Number(deviceId)]: { ...all[Number(deviceId)]!, status: c.status, result: c.result } }));
        })
        .catch(() => {});
    }
  }, [tracks]);
  usePoll(recheck, open && waiting, 5000);

  // Tell the person once everything is finished
  useEffect(() => {
    if (!finished) return;
    const ok = Object.values(tracks).filter((t) => t.status === 'success').length;
    if (ok) toast(received ? `${received} people received from ${ok} device${ok === 1 ? '' : 's'}` : `Finished on ${ok} device${ok === 1 ? '' : 's'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  async function start() {
    setBusy(true);
    setError(null);
    setReceived(0);
    const next: Record<number, Track> = {};
    const failures: string[] = [];
    for (const id of selected) {
      const d = list.find((x) => x.id === id);
      try {
        const r = await api<{ command: DeviceCommand | null }>(`/device-control/devices/${id}/commands`, { method: 'POST', body: { action: 'fetch_users' } });
        if (r.command) next[id] = { commandId: r.command.id, status: r.command.status, result: r.command.result, channel: r.command.channel };
      } catch (err) {
        failures.push(`${d?.name ?? `Device ${id}`}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setTracks(next);
    if (failures.length) setError(failures.join(' · '));
    setBusy(false);
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Modal
      open={open}
      wide
      title="Fetch employees from devices"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {finished ? 'Close' : started ? 'Hide (keeps running)' : 'Cancel'}
          </button>
          {!started || finished ? (
            <button className="btn-primary" onClick={start} disabled={busy || selected.size === 0}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="download" className="h-4 w-4" />}
              {finished ? 'Fetch again' : selected.size > 1 ? `Fetch from ${selected.size} devices` : 'Fetch employees'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Reads everyone enrolled on the device (code, name, card, privilege) into Employees. People already here are updated, nobody is deleted. Fingerprints and faces come
          along on push devices.
        </p>

        {devices.data?.adms.forwarding && (
          <Alert tone="warning">Push is forwarding to BioTime, so this server can’t send requests to push devices. Turn forwarding off in Settings &gt; Push (ADMS).</Alert>
        )}
        {error && <Alert>{error}</Alert>}

        {started && (
          <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
            {waiting ? <Spinner className="h-5 w-5 text-brand-600" /> : <Icon name="check" className="h-5 w-5 text-brand-700" />}
            <div className="text-sm">
              <div className="font-semibold text-brand-900">{waiting ? 'Fetching…' : 'Finished'}</div>
              <div className="text-xs text-brand-800">
                {received ? `${received} people received so far. The Employees list updates by itself.` : waiting ? 'People appear in the list as they arrive.' : 'The Employees list is up to date.'}
              </div>
            </div>
          </div>
        )}

        {devices.loading && !devices.data ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : devices.error ? (
          <Alert onRetry={devices.reload}>{devices.error}</Alert>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
            No devices yet. Add your device in{' '}
            <Link href="/settings" className="font-medium text-brand-700 hover:underline">
              Settings &gt; Devices
            </Link>{' '}
            first.
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((d) => {
              const can = usable(d);
              const t = tracks[d.id];
              return (
                <li key={d.id} className={`rounded-xl border p-3 ${t ? 'border-brand-200 bg-white' : selected.has(d.id) ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'}`}>
                  <label className={`flex items-center gap-3 ${can && !started ? 'cursor-pointer' : ''}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                      disabled={!can || (started && !finished)}
                    />
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Icon name="device" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{d.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {[d.serial_number, d.push?.info?.users != null ? `${d.push.info.users} users on device` : null, d.mode === 'pull' ? 'over network' : 'via push']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <StatusBadge d={d} />
                  </label>
                  {!can && <p className="mt-2 text-xs text-amber-700">{d.enabled ? d.capabilities.query_users.reason : 'This device is disabled in Settings.'}</p>}
                  {can && !online(d) && !t && (
                    <p className="mt-2 text-xs text-amber-700">Not connected right now. The request waits and runs as soon as the device checks in.</p>
                  )}
                  {t && <Progress t={t} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
