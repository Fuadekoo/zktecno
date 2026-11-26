'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CommandLog, usePoll } from '@/components/device-control';
import { Icon } from '@/components/icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError } from '@/lib/api';
import { daysAgoISO, timeAgo, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Capability, ControlDevice } from '@/lib/types';

type Action = 'fetch_punches' | 'fetch_users' | 'send_all_employees' | 'check' | 'reboot';

const ACTIONS: { action: Action; label: string; cap: keyof ControlDevice['capabilities']; hint: string }[] = [
  { action: 'fetch_punches', label: 'Fetch punches…', cap: 'query_attlog', hint: 'Ask the device for its punches in a date range' },
  { action: 'fetch_users', label: 'Fetch users', cap: 'query_users', hint: 'Read the people enrolled on the device into Employees' },
  { action: 'send_all_employees', label: 'Send all employees', cap: 'users', hint: 'Put every employee (and saved fingerprints/faces) on this device' },
  { action: 'check', label: 'Upload new data', cap: 'reboot', hint: 'Ask the device to upload anything it has not sent yet' },
  { action: 'reboot', label: 'Reboot', cap: 'reboot', hint: 'Restart the device' },
];

function Status({ d }: { d: ControlDevice }) {
  if (!d.enabled) return <span className="badge bg-slate-100 text-slate-500">Disabled</span>;
  if (d.push?.polling) return <span className="badge bg-brand-50 text-brand-700">Online (ADMS)</span>;
  if (d.push) return <span className="badge bg-amber-50 text-amber-700">Last push {timeAgo(d.push.last_seen)}</span>;
  if (d.mode === 'pull') return <span className="badge bg-sky-50 text-sky-700">Network (4370)</span>;
  return <span className="badge bg-slate-100 text-slate-500">Never pushed</span>;
}

function ActionButton({ label, cap, hint, onClick, disabled }: { label: string; cap: Capability; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="btn-secondary px-2.5 py-1 text-xs"
      onClick={onClick}
      disabled={disabled || !cap.ok}
      title={cap.ok ? `${hint} (${cap.via === 'push' ? 'via ADMS' : 'via network'})` : cap.reason ?? ''}
    >
      {label}
    </button>
  );
}

export default function LocalDevices() {
  const toast = useToast();
  const { isAdmin } = useUser();
  const { data, error, loading, reload } = useApi<{ adms: { enabled: boolean; forwarding: boolean; port: number }; data: ControlDevice[] }>('/device-control/devices');
  const [logDevice, setLogDevice] = useState<number | ''>('');
  const [logKey, setLogKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [rangeFor, setRangeFor] = useState<ControlDevice | null>(null);
  const [range, setRange] = useState({ start: daysAgoISO(7), end: todayISO() });
  const [rangeErrors, setRangeErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ d: ControlDevice; action: 'reboot' | 'send_all_employees' } | null>(null);
  usePoll(reload, true, 10_000);

  async function run(d: ControlDevice, action: Action, extra: Record<string, string> = {}) {
    setBusy(`${d.id}:${action}`);
    try {
      const r = await api<{ message: string; queued: number; command: { channel: 'push' | 'pull' } | null }>(`/device-control/devices/${d.id}/commands`, { method: 'POST', body: { action, ...extra } });
      const how = r.command?.channel === 'push' ? ' The device picks it up at its next poll.' : r.command?.channel === 'pull' ? ' Connecting to the device now.' : '';
      toast(`${r.message}.${how}`);
      setRangeFor(null);
      setConfirm(null);
      setLogKey((k) => k + 1);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setRangeErrors(err.fields);
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  const devices = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Devices"
        description="Your attendance devices. Ask a device for data, send people to it, and see every command and its result. Add or edit devices in Settings."
        actions={
          <>
            <button className="btn-secondary" onClick={reload} disabled={loading}>
              <Icon name="refresh" className="h-4 w-4" /> Refresh
            </button>
            {isAdmin && (
              <Link href="/settings" className="btn-secondary">
                <Icon name="settings" className="h-4 w-4" /> Manage devices
              </Link>
            )}
          </>
        }
      />

      {data && !data.adms.enabled && (
        <div className="mb-4"><Alert tone="info">ADMS push is off, so only network (pull) devices can be reached. Turn it on in Settings → ADMS to use push devices, which work behind any router and support fingerprint/face copying.</Alert></div>
      )}
      {data?.adms.forwarding && (
        <div className="mb-4"><Alert tone="warning">ADMS is forwarding to BioTime, so BioTime sends commands to push devices. Turn forwarding off in Settings → ADMS to manage push devices from here.</Alert></div>
      )}

      <div className="card mb-6">
        <TableState loading={loading} error={error} empty={!devices.length} onRetry={reload} emptyTitle="No devices yet" emptyHint="Add your devices in Settings → Devices.">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Device</th>
                <th>Connection</th>
                <th className="text-right">Users</th>
                <th className="text-right">Fingerprints</th>
                <th className="text-right">Faces</th>
                <th className="text-right">Waiting</th>
                {isAdmin && <th>Ask the device</th>}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td><Status d={d} /></td>
                  <td>
                    <div className="font-medium text-slate-900">{d.name}</div>
                    <div className="text-xs text-slate-500">{[d.serial_number, d.location, d.firmware].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td className="text-xs text-slate-600">
                    <div className="capitalize">{d.mode}</div>
                    <div>{[d.ip && `${d.ip}:${d.port}`, d.push?.ip && d.push.ip !== d.ip && `push from ${d.push.ip}`].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td className="text-right tabular-nums">{d.push?.info?.users ?? '—'}</td>
                  <td className="text-right tabular-nums">{d.push?.info?.fingerprints ?? '—'}</td>
                  <td className="text-right tabular-nums">{d.push?.info?.faces ?? '—'}</td>
                  <td className="text-right">
                    <button className="tabular-nums text-brand-700 underline-offset-2 hover:underline" onClick={() => setLogDevice(d.id)} title="Show this device's commands">
                      {d.pending_commands}
                    </button>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {ACTIONS.map((a) => (
                          <ActionButton
                            key={a.action}
                            label={a.label}
                            hint={a.hint}
                            cap={d.capabilities[a.cap]}
                            disabled={busy !== null}
                            onClick={() => {
                              if (a.action === 'fetch_punches') { setRangeErrors({}); setRangeFor(d); }
                              else if (a.action === 'reboot' || a.action === 'send_all_employees') setConfirm({ d, action: a.action });
                              else void run(d, a.action);
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-semibold text-slate-900">Command log</h2>
          <select className="input w-56 py-1.5" value={logDevice} onChange={(e) => setLogDevice(e.target.value ? Number(e.target.value) : '')} aria-label="Device">
            <option value="">All devices</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <CommandLog deviceId={logDevice || undefined} refreshKey={logKey} />
      </div>

      <Modal
        open={Boolean(rangeFor)}
        title={`Fetch punches from ${rangeFor?.name ?? ''}`}
        onClose={() => setRangeFor(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRangeFor(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy !== null} onClick={() => rangeFor && run(rangeFor, 'fetch_punches', { start_date: range.start, end_date: range.end })}>
              {busy && <Spinner className="h-4 w-4 text-white" />} Fetch
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" error={rangeErrors.start_date}>
            <input className="input" type="date" value={range.start} max={range.end} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
          </Field>
          <Field label="To" error={rangeErrors.end_date}>
            <input className="input" type="date" value={range.end} min={range.start} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {rangeFor?.capabilities.query_attlog.via === 'push'
            ? 'The device sends these punches at its next poll (about 10 seconds). Punches already saved are skipped.'
            : 'The server connects to the device and reads its log now. Punches already saved are skipped.'}
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === 'reboot' ? 'Reboot device' : 'Send all employees'}
        confirmLabel={confirm?.action === 'reboot' ? 'Reboot' : 'Send'}
        message={
          confirm?.action === 'reboot'
            ? <>Restart <strong>{confirm.d.name}</strong>? It is unavailable for about a minute.</>
            : <>Put every employee on <strong>{confirm?.d.name}</strong>, with their saved fingerprints and faces (push devices)? People already on it are updated, not duplicated.</>
        }
        busy={busy !== null}
        onConfirm={() => confirm && run(confirm.d, confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
