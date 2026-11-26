'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, Modal, Pagination, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, type Paginated } from '@/lib/api';
import { shortDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { CommandKind, CommandStatus, DeviceCommand, EmployeeDevices } from '@/lib/types';

export const KIND_LABEL: Record<CommandKind, string> = {
  user_upsert: 'Add / update person',
  user_delete: 'Remove person',
  template_upsert: 'Copy fingerprint / face',
  enroll_fp: 'Enroll fingerprint',
  query_attlog: 'Fetch punches',
  query_users: 'Fetch users',
  reboot: 'Reboot',
  check: 'Upload new data',
};

/** Finger numbers as ZKTeco devices use them. */
export const FINGERS = [
  'Left little', 'Left ring', 'Left middle', 'Left index', 'Left thumb',
  'Right thumb', 'Right index', 'Right middle', 'Right ring', 'Right little',
];

const STATUS_STYLE: Record<CommandStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  sent: 'bg-sky-50 text-sky-700',
  success: 'bg-brand-50 text-brand-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};
const STATUS_LABEL: Record<CommandStatus, string> = {
  pending: 'Waiting',
  sent: 'Sent, awaiting reply',
  success: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function CommandStatusBadge({ status }: { status: CommandStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** Re-run `fn` every `ms` while `active`. */
export function usePoll(fn: () => void, active: boolean, ms = 4000) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, active, ms]);
}

/** The command log, refreshing itself while anything is still waiting. */
export function CommandLog({ deviceId, empCode, refreshKey = 0, pageSize = 15 }: { deviceId?: number; empCode?: string; refreshKey?: number; pageSize?: number }) {
  const toast = useToast();
  const { isAdmin } = useUser();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<Paginated<DeviceCommand>>('/device-control/commands', {
    device_id: deviceId,
    emp_code: empCode,
    status,
    page,
    page_size: pageSize,
    _: refreshKey,
  });
  const waiting = Boolean(data?.data.some((c) => c.status === 'pending' || c.status === 'sent'));
  usePoll(reload, waiting);

  async function act(c: DeviceCommand, action: 'retry' | 'cancel') {
    try {
      await api(`/device-control/commands/${c.id}/${action}`, { method: 'POST' });
      toast(action === 'retry' ? `Command #${c.id} queued again` : `Command #${c.id} cancelled`);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {waiting && <Spinner className="h-4 w-4" />}
          {waiting ? 'Waiting for devices… (refreshes by itself)' : 'Commands sent to devices'}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-44 py-1.5" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as CommandStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button className="btn-secondary py-1.5" onClick={reload} disabled={loading}>
            <Icon name="refresh" className="h-4 w-4" />
          </button>
        </div>
      </div>
      <TableState loading={loading} error={error} empty={!data?.data.length} onRetry={reload} emptyTitle="No commands yet" emptyHint="Commands appear here when you add or change people, or ask a device for data.">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              {!deviceId && <th>Device</th>}
              <th>What</th>
              {!empCode && <th>Person</th>}
              <th>Status</th>
              <th>Result</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {data?.data.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs text-slate-500">{c.id}</td>
                <td className="whitespace-nowrap text-slate-600" title={c.created_at}>{shortDateTime(c.created_at)}</td>
                {!deviceId && <td className="whitespace-nowrap">{c.device_name ?? `#${c.device_id}`}</td>}
                <td>
                  <div className="font-medium text-slate-900">{KIND_LABEL[c.kind] ?? c.kind}</div>
                  <div className="text-xs text-slate-500">{c.channel === 'push' ? 'via ADMS (device polls)' : 'via network (port 4370)'}</div>
                </td>
                {!empCode && <td className="font-mono text-xs">{c.emp_code ?? '—'}</td>}
                <td><CommandStatusBadge status={c.status} /></td>
                <td className="max-w-80 text-xs text-slate-600">
                  {c.result ?? (c.status === 'pending' && c.channel === 'push' ? 'Picked up at the device’s next poll' : '—')}
                </td>
                {isAdmin && (
                  <td className="whitespace-nowrap text-right">
                    {(c.status === 'failed' || c.status === 'cancelled' || c.status === 'sent') && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(c, 'retry')}>Retry</button>
                    )}
                    {(c.status === 'pending' || c.status === 'sent') && (
                      <button className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => act(c, 'cancel')}>Cancel</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableState>
      {data && data.count > pageSize && <Pagination page={page} pageSize={pageSize} count={data.count} onPage={setPage} />}
    </>
  );
}

/** One person on every device: what reached each device, their fingerprints/faces, resend and enroll. */
export function EmployeeDevicesModal({ employeeId, onClose, onChanged }: { employeeId: number | null; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const { isAdmin } = useUser();
  const { data, error, loading, reload } = useApi<EmployeeDevices>(employeeId ? `/device-control/employees/${employeeId}` : null);
  const [busy, setBusy] = useState(false);
  const [enrollDevice, setEnrollDevice] = useState('');
  const [finger, setFinger] = useState('6');
  const [logKey, setLogKey] = useState(0);
  const waiting = Boolean(data?.commands.some((c) => c.status === 'pending' || c.status === 'sent'));
  usePoll(reload, Boolean(employeeId) && waiting);

  const enrollable = data?.devices.filter((d) => d.capabilities.enroll.ok) ?? [];
  useEffect(() => {
    if (enrollable.length && !enrollable.some((d) => String(d.id) === enrollDevice)) setEnrollDevice(String(enrollable[0]!.id));
  }, [enrollable, enrollDevice]);

  async function resend() {
    setBusy(true);
    try {
      const r = await api<{ queued: number; skipped: string[] }>(`/device-control/employees/${employeeId}/push`, { method: 'POST' });
      toast(r.skipped.length ? `Queued for ${r.queued} device(s); skipped: ${r.skipped.join('; ')}` : `Queued for ${r.queued} device(s)`, r.skipped.length && !r.queued ? 'error' : 'success');
      reload();
      setLogKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    setBusy(true);
    try {
      await api(`/device-control/employees/${employeeId}/enroll`, { method: 'POST', body: { device_id: Number(enrollDevice), finger: Number(finger) } });
      toast('Enrollment started: the person should place the finger on the device 3 times');
      reload();
      setLogKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const fp = data?.templates.filter((t) => t.bio_type === 1) ?? [];
  const faces = [...new Map((data?.templates.filter((t) => t.bio_type !== 1) ?? []).map((t) => [`${t.bio_type}`, t])).values()];

  return (
    <Modal wide open={employeeId !== null} title={data ? `${data.employee.name || data.employee.emp_code} on devices` : 'Devices & biometrics'} onClose={onClose}>
      {error ? (
        <Alert onRetry={reload}>{error}</Alert>
      ) : !data ? (
        <div className="flex justify-center py-12"><Spinner className="h-7 w-7" /></div>
      ) : (
        <div className={`space-y-6 ${loading ? 'opacity-80' : ''}`}>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Devices</h3>
              {isAdmin && (
                <button className="btn-secondary py-1.5" onClick={resend} disabled={busy || !data.devices.length}>
                  <Icon name="send" className="h-4 w-4" /> Send to all devices again
                </button>
              )}
            </div>
            {data.devices.length ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="table">
                  <thead><tr><th>Device</th><th>Mode</th><th>Person on device</th><th>Last result</th></tr></thead>
                  <tbody>
                    {data.devices.map((d) => (
                      <tr key={d.id}>
                        <td className="font-medium text-slate-900">{d.name}{!d.enabled && <span className="ml-2 text-xs text-slate-400">(disabled)</span>}</td>
                        <td className="capitalize text-slate-600">{d.mode}</td>
                        <td>
                          {d.status ? (
                            d.status.kind === 'user_delete' ? <span className="badge bg-slate-100 text-slate-500">Removed</span> : <CommandStatusBadge status={d.status.status} />
                          ) : (
                            <span className="text-xs text-slate-500">{d.capabilities.users.ok ? 'Never sent' : d.capabilities.users.reason}</span>
                          )}
                        </td>
                        <td className="text-xs text-slate-600">{d.status ? `${d.status.result ?? '—'} · ${timeAgo(d.status.at)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No devices yet. Add one in Settings → Devices.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Fingerprints & face</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Icon name="fingerprint" className="h-4 w-4 text-brand-600" /> {fp.length} fingerprint{fp.length === 1 ? '' : 's'}</div>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {fp.map((t) => <li key={t.id}>{FINGERS[t.finger ?? 0] ?? `Finger ${t.finger}`} · from {t.source_sn ?? 'unknown'} · {timeAgo(t.updated_at)}</li>)}
                  {!fp.length && <li>None saved yet</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Icon name="users" className="h-4 w-4 text-brand-600" /> {faces.length ? 'Face enrolled' : 'No face'}</div>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {faces.map((t) => <li key={t.id}>{t.label} · from {t.source_sn ?? 'unknown'} · {timeAgo(t.updated_at)}</li>)}
                  {!faces.length && <li>None saved yet</li>}
                </ul>
              </div>
            </div>

            {isAdmin && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-medium text-slate-900">Enroll fingerprint or face</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600">
                  <li>On the device: <strong>Menu → User Mgt → All Users</strong>, find user <strong className="font-mono">{data.employee.emp_code}</strong>, then <strong>Edit</strong>.</li>
                  <li>Choose <strong>Fingerprint</strong> (scan the same finger 3 times) and/or <strong>Face</strong> (look at the camera until it confirms).</li>
                  <li>Push devices upload the new fingerprint/face here within seconds and it is copied to your other push devices automatically.</li>
                </ol>
                {enrollable.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4">
                    <label>
                      <span className="label">Or start fingerprint enrollment remotely on</span>
                      <select className="input py-1.5" value={enrollDevice} onChange={(e) => setEnrollDevice(e.target.value)}>
                        {enrollable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="label">Finger</span>
                      <select className="input py-1.5" value={finger} onChange={(e) => setFinger(e.target.value)}>
                        {FINGERS.map((f, i) => <option key={i} value={i}>{f}</option>)}
                      </select>
                    </label>
                    <button className="btn-primary py-1.5" onClick={enroll} disabled={busy || !enrollDevice}>
                      <Icon name="fingerprint" className="h-4 w-4" /> Start on device
                    </button>
                    <p className="w-full text-xs text-slate-500">The device shows the enrollment screen at its next poll (about 10 s). Not every firmware supports this; if nothing happens, enroll from the device menu.</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="-mx-6 border-t border-slate-200">
            <h3 className="px-6 pt-4 text-sm font-semibold text-slate-900">Recent commands for this person</h3>
            <CommandLog empCode={data.employee.emp_code} refreshKey={logKey} pageSize={8} />
          </section>
        </div>
      )}
    </Modal>
  );
}
