'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { intervalLabel, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AppSettings, DeviceMode, DeviceSetting, NetworkInfo, SettingsResponse, ZkDeviceStatus } from '@/lib/types';

type Tab = 'devices' | 'adms' | 'sync' | 'biotime';
const TABS: { id: Tab; label: string; icon: 'device' | 'wifi' | 'refresh' | 'database' }[] = [
  { id: 'devices', label: 'Devices', icon: 'device' },
  { id: 'adms', label: 'Push (ADMS)', icon: 'wifi' },
  { id: 'sync', label: 'Sync', icon: 'refresh' },
  { id: 'biotime', label: 'BioTime', icon: 'database' },
];

export default function SettingsPage() {
  const { isAdmin } = useUser();
  const { data, error, loading, reload, setData } = useApi<SettingsResponse>(isAdmin ? '/settings' : null);
  const [tab, setTab] = useState<Tab>('devices');

  if (!isAdmin) return <Alert>Only administrators can change settings.</Alert>;

  return (
    <>
      <PageHeader title="Settings" description="Devices and connections. Saved in the database and applied right away, no restart needed." />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : error ? (
        <Alert onRetry={reload}>{error}</Alert>
      ) : data ? (
        <>
          {tab === 'devices' && <DevicesTab data={data} reload={reload} />}
          {tab !== 'devices' && (
            <SectionForm
              key={tab}
              section={tab}
              settings={data.settings}
              network={data.network}
              onSaved={(settings, network) => setData({ ...data, settings, network })}
            />
          )}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Devices

const MODE_INFO: Record<DeviceMode, { label: string; short: string; help: string }> = {
  pull: {
    label: 'Pull',
    short: 'Server reads the device',
    help: 'This server connects to the device over the network (TCP, or UDP if TCP is refused) on port 4370 and downloads users and punches at every sync. The device must be reachable from this PC.',
  },
  push: {
    label: 'Push (ADMS)',
    short: 'Device sends to the server',
    help: 'The device sends each punch to this server the moment it happens (Menu > COMM. > Cloud Server Setting). Works across networks and for devices behind a router. Needs the serial number.',
  },
  both: {
    label: 'Both',
    short: 'Live push + safety read',
    help: 'Punches arrive live by push, and the server also reads the device at every sync to catch anything missed while offline. Most reliable. Needs IP and serial number.',
  },
};

type DeviceForm = {
  name: string;
  mode: DeviceMode;
  ip: string;
  port: string;
  serial_number: string;
  location: string;
  timeout_ms: string;
  chunk_size: string;
  enabled: boolean;
};

function emptyDevice(timeout: number): DeviceForm {
  return { name: '', mode: 'pull', ip: '', port: '4370', serial_number: '', location: '', timeout_ms: String(timeout), chunk_size: '', enabled: true };
}

function DevicesTab({ data, reload }: { data: SettingsResponse; reload: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<DeviceSetting | 'new' | null>(null);
  const [prefill, setPrefill] = useState<Partial<DeviceForm> | null>(null);
  const [deleting, setDeleting] = useState<DeviceSetting | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, ZkDeviceStatus>>({});

  async function test(d: DeviceSetting) {
    setTesting(d.id);
    try {
      const r = await api<ZkDeviceStatus>(`/settings/devices/${d.id}/test`, { method: 'POST' });
      setResults((x) => ({ ...x, [d.id]: r }));
      toast(r.online ? `${d.name}: connected (${r.latency_ms} ms)` : `${d.name}: ${r.error}`, r.online ? 'success' : 'error');
      if (r.online) reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Test failed', 'error');
    } finally {
      setTesting(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/settings/devices/${deleting.id}`, { method: 'DELETE' });
      toast(`${deleting.name} removed`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      {data.unknown_push_devices.length > 0 && (
        <div className="mb-4 space-y-2">
          {data.unknown_push_devices.map((u) => (
            <Alert key={u.sn} tone="info">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Device <strong className="font-mono">{u.sn}</strong>
                  {u.ip ? ` (${u.ip})` : ''} is pushing to this server but isn’t in your list. Last seen {timeAgo(u.last_seen)}.
                </span>
                <button
                  className="btn-secondary py-1"
                  onClick={() => {
                    setPrefill({ name: `Device ${u.sn}`, mode: 'push', serial_number: u.sn, ip: u.ip ?? '' });
                    setEditing('new');
                  }}
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Add it
                </button>
              </span>
            </Alert>
          ))}
        </div>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Attendance devices</h2>
            <p className="text-xs text-slate-500">Any ZKTeco device (and most rebrands) that supports the standard protocol on port 4370 and/or ADMS push.</p>
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setPrefill(null);
              setEditing('new');
            }}
          >
            <Icon name="plus" className="h-4 w-4" />
            Add device
          </button>
        </div>
        <TableState loading={false} error={null} empty={!data.devices.length} emptyTitle="No devices yet" emptyHint="Add your first device to start collecting punches.">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Connection</th>
                  <th>Address</th>
                  <th>Serial number</th>
                  <th>Status</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => {
                  const r = results[d.id];
                  return (
                    <tr key={d.id} className={d.enabled ? '' : 'opacity-50'}>
                      <td>
                        <div className="font-medium text-slate-900">{d.name}</div>
                        <div className="text-xs text-slate-500">
                          {[d.model, d.firmware, d.location].filter(Boolean).join(' · ') || (d.enabled ? 'Not tested yet' : 'Disabled')}
                        </div>
                      </td>
                      <td>
                        <span className="badge bg-slate-100 text-slate-700">{MODE_INFO[d.mode].label}</span>
                      </td>
                      <td className="font-mono text-xs">{d.ip ? `${d.ip}:${d.port}` : '—'}</td>
                      <td className="font-mono text-xs">{d.serial_number || '—'}</td>
                      <td className="text-xs">
                        {!d.enabled ? (
                          <span className="badge bg-slate-100 text-slate-500">Disabled</span>
                        ) : r ? (
                          r.online ? (
                            <span className="badge bg-brand-50 text-brand-700" title={r.error ?? ''}>
                              Online · {r.connection?.toUpperCase()} · {r.user_count ?? '?'} users · {r.log_count ?? '?'} punches
                            </span>
                          ) : (
                            <span className="badge max-w-64 truncate bg-red-50 text-red-700" title={r.error ?? ''}>
                              Offline: {r.error}
                            </span>
                          )
                        ) : (
                          <div className="space-y-0.5 text-slate-500">
                            {d.mode !== 'push' && <div>Read OK: {d.last_seen_at ? timeAgo(d.last_seen_at) : 'never'}</div>}
                            {d.mode !== 'pull' && <div>Last push: {d.last_push_at ? timeAgo(d.last_push_at) : 'none since server start'}</div>}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        {d.ip && (
                          <button className="btn-ghost text-xs" onClick={() => test(d)} disabled={testing !== null} title="Test connection">
                            {testing === d.id ? <Spinner className="h-4 w-4" /> : <Icon name="wifi" className="h-4 w-4" />}
                            Test
                          </button>
                        )}
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            setPrefill(null);
                            setEditing(d);
                          }}
                          aria-label={`Edit ${d.name}`}
                        >
                          <Icon name="edit" className="h-4 w-4" />
                        </button>
                        <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setDeleting(d)} aria-label={`Remove ${d.name}`}>
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TableState>
      </section>

      <DeviceModal
        editing={editing}
        prefill={prefill}
        defaultTimeout={data.settings.sync.device_timeout_ms}
        network={data.network}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove device"
        message={
          <>
            Remove <strong>{deleting?.name}</strong>? The server stops reading it and stops accepting its pushes. Punches already saved are kept.
          </>
        }
        confirmLabel="Remove"
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function DeviceModal({
  editing,
  prefill,
  defaultTimeout,
  network,
  onClose,
  onSaved,
}: {
  editing: DeviceSetting | 'new' | null;
  prefill: Partial<DeviceForm> | null;
  defaultTimeout: number;
  network: NetworkInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<DeviceForm>(emptyDevice(defaultTimeout));
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ZkDeviceStatus | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setFields({});
    setFormError(null);
    setTest(null);
    if (editing === 'new') {
      setForm({ ...emptyDevice(defaultTimeout), ...prefill });
      setAdvanced(false);
    } else {
      setForm({
        name: editing.name,
        mode: editing.mode,
        ip: editing.ip ?? '',
        port: String(editing.port),
        serial_number: editing.serial_number ?? '',
        location: editing.location ?? '',
        timeout_ms: String(editing.timeout_ms),
        chunk_size: editing.chunk_size ? String(editing.chunk_size) : '',
        enabled: editing.enabled,
      });
      setAdvanced(Boolean(editing.chunk_size) || editing.timeout_ms !== defaultTimeout);
    }
  }, [editing, prefill, defaultTimeout]);

  const set = <K extends keyof DeviceForm>(k: K, v: DeviceForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const needsIp = form.mode !== 'push';
  const needsSn = form.mode !== 'pull';

  async function runTest() {
    if (!form.ip) {
      setFields({ ip: 'Enter the IP address first' });
      return;
    }
    setTesting(true);
    setTest(null);
    setFields({});
    try {
      const r = await api<ZkDeviceStatus>('/settings/devices/test', {
        method: 'POST',
        body: { ip: form.ip, port: form.port, timeout_ms: form.timeout_ms, chunk_size: form.chunk_size },
      });
      setTest(r);
      if (r.online) {
        // Fill in what the device told us
        setForm((f) => ({
          ...f,
          serial_number: f.serial_number || r.serial_number || '',
          name: f.name || r.device_name || `Device ${f.ip}`,
        }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setFormError(null);
    const body = { ...form, ip: needsIp || form.ip ? form.ip : '', serial_number: form.serial_number };
    try {
      if (editing === 'new') {
        await api('/settings/devices', { method: 'POST', body });
        toast(`${form.name} added${form.mode !== 'push' && form.enabled ? '. Reading its users and punches now…' : ''}`);
      } else if (editing) {
        await api(`/settings/devices/${editing.id}`, { method: 'PUT', body });
        toast(`${form.name} saved`);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={editing !== null}
      wide
      title={editing === 'new' ? 'Add device' : `Edit ${editing?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" form="device-form" disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            Save device
          </button>
        </>
      }
    >
      <form id="device-form" onSubmit={save} className="space-y-5">
        {formError && <Alert>{formError}</Alert>}

        <div>
          <span className="label">How does this device connect?</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(MODE_INFO) as DeviceMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => set('mode', m)}
                className={`rounded-lg border p-3 text-left transition ${
                  form.mode === m ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">{MODE_INFO[m].label}</div>
                <div className="text-xs text-slate-500">{MODE_INFO[m].short}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{MODE_INFO[form.mode].help}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name *" error={fields.name} hint="Anything that helps you recognise it, e.g. “Main gate”">
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} required />
          </Field>
          <Field label="Location" error={fields.location}>
            <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={128} placeholder="e.g. Ground floor" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <Field label={needsIp ? 'IP address *' : 'IP address (optional)'} error={fields.ip} hint="On the device: Menu > COMM. > Ethernet">
            <input className="input font-mono" value={form.ip} onChange={(e) => set('ip', e.target.value.trim())} placeholder="192.168.1.201" required={needsIp} />
          </Field>
          <Field label="Port" error={fields.port}>
            <input className="input font-mono" type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', e.target.value)} />
          </Field>
          <button type="button" className="btn-secondary mb-[1.35rem]" onClick={runTest} disabled={testing || !form.ip}>
            {testing ? <Spinner className="h-4 w-4" /> : <Icon name="wifi" className="h-4 w-4" />}
            Test connection
          </button>
        </div>

        {test && <TestResult r={test} />}

        <Field
          label={needsSn ? 'Serial number *' : 'Serial number (optional)'}
          error={fields.serial_number}
          hint="Menu > System Info > Device Info. “Test connection” fills it in for you."
        >
          <input className="input font-mono" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value.trim())} placeholder="e.g. CIZW204560345" required={needsSn} />
        </Field>

        {needsSn && <PushInstructions network={network} />}

        <div>
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Advanced (slow or remote connections)
          </button>
          {advanced && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Timeout (ms)" error={fields.timeout_ms} hint="Raise it for slow links (e.g. 20000)">
                <input className="input" type="number" min={1000} max={120000} step={1000} value={form.timeout_ms} onChange={(e) => set('timeout_ms', e.target.value)} />
              </Field>
              <Field label="Download chunk size (bytes)" error={fields.chunk_size} hint="Empty = default. Try 8184 if big downloads stall over VPN/Internet">
                <input className="input" type="number" min={1024} max={65472} value={form.chunk_size} onChange={(e) => set('chunk_size', e.target.value)} placeholder="65472" />
              </Field>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Enabled <span className="text-xs text-slate-400">(turn off to pause a device without deleting it)</span>
        </label>

        <p className="text-xs text-slate-400">
          Note: if a <em>communication password</em> (Comm Key) is set on the device, set it to 0, because direct reading doesn’t support it. Push (ADMS) is not affected.
        </p>
      </form>
    </Modal>
  );
}

function TestResult({ r }: { r: ZkDeviceStatus }) {
  if (!r.online) {
    return (
      <Alert>
        Couldn’t connect: {r.error}. Check that the device is on, the IP and port are right, and this PC is on the same network. Also check that the Comm Key is 0.
      </Alert>
    );
  }
  const rows: [string, ReactNode][] = [
    ['Model', r.device_name],
    ['Serial number', <span className="font-mono">{r.serial_number}</span>],
    ['Firmware', r.firmware],
    ['Connection', `${r.connection?.toUpperCase()} · ${r.latency_ms} ms`],
    ['Users', r.user_count],
    ['Punches stored', r.log_count !== null ? `${r.log_count}${r.log_capacity ? ` of ${r.log_capacity.toLocaleString()}` : ''}` : null],
    ['Device clock', r.device_time],
  ];
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-brand-800">
        <Icon name="check" className="h-4 w-4" />
        Connected
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {rows
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function PushInstructions({ network }: { network: NetworkInfo }) {
  if (!network.adms_enabled) {
    return <Alert tone="warning">Push (ADMS) is turned off, so this device’s pushes won’t be received. Turn it on in the “Push (ADMS)” tab.</Alert>;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <div className="mb-1 font-semibold text-slate-800">On the device: Menu &gt; COMM. &gt; Cloud Server Setting</div>
      <ul className="list-inside list-disc space-y-0.5">
        <li>
          Server address: <strong className="font-mono">{network.server_ips.join(' or ') || 'this PC’s IP address'}</strong> (the one on the device’s network)
        </li>
        <li>
          Server port: <strong className="font-mono">{network.adms_port}</strong>
        </li>
        <li>Enable domain name: off · HTTPS: off · Proxy: off</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Settings sections

type Section = Exclude<Tab, 'devices'>;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function SectionForm({
  section,
  settings,
  network,
  onSaved,
}: {
  section: Section;
  settings: AppSettings;
  network: NetworkInfo;
  onSaved: (s: AppSettings, n: NetworkInfo) => void;
}) {
  const toast = useToast();
  // Numbers are edited as text and checked by the server
  const [form, setForm] = useState<Record<string, string | boolean>>(() => toForm(settings[section]));
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => String(form[k] ?? '');
  const bool = (k: string) => Boolean(form[k]);
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings[section]));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setFormError(null);
    try {
      const body = { ...form };
      if (section === 'biotime') delete body.password_set;
      const r = await api<{ settings: AppSettings; network: NetworkInfo; changed: string[] }>(`/settings/${section}`, { method: 'PUT', body });
      onSaved(r.settings, r.network);
      setForm(toForm(r.settings[section]));
      toast(r.changed.length ? 'Settings saved and applied' : 'Nothing changed');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function testBiotime() {
    setTesting(true);
    setTestResult(null);
    try {
      const body = { ...form };
      delete body.password_set;
      delete body.enabled;
      setTestResult(await api<{ ok: boolean; message: string }>('/settings/biotime/test', { method: 'POST', body }));
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  const num = (k: string, label: string, hint?: string, props: Record<string, number> = {}) => (
    <Field label={label} error={fields[k]} hint={hint}>
      <input className="input" type="number" value={str(k)} onChange={(e) => set(k, e.target.value)} {...props} />
    </Field>
  );

  return (
    <form onSubmit={save} className="card max-w-3xl">
      <div className="space-y-5 p-5">
        {formError && <Alert>{formError}</Alert>}

        {section === 'adms' && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Status:
              {network.adms_listening ? (
                <span className="badge bg-brand-50 text-brand-700">Listening on port {network.adms_port}</span>
              ) : network.adms_enabled ? (
                <span className="badge bg-red-50 text-red-700">Not listening (port busy or misconfigured, see server log)</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">Off</span>
              )}
            </div>
            <Toggle checked={bool('enabled')} onChange={(v) => set('enabled', v)} label="Receive pushes from devices (ADMS / Cloud Server)" hint="Devices send each punch here the moment it happens." />
            <div className="grid gap-4 sm:grid-cols-2">
              {num('port', 'Push port', 'Enter this port on each device. Open it in the Windows firewall.', { min: 1, max: 65535 })}
            </div>
            <Toggle
              checked={bool('accept_any')}
              onChange={(v) => set('accept_any', v)}
              label="Accept any device"
              hint="On: save punches from every device that pushes here (easy setup / testing). Off: only devices listed under Devices with their serial number."
            />
            <Toggle
              checked={bool('forward')}
              onChange={(v) => set('forward', v)}
              label="Also forward pushes to BioTime"
              hint="Only if you still run BioTime and want it to keep receiving everything."
            />
            {bool('forward') && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Forward to" error={fields.forward_url} hint="Empty = the BioTime address in the BioTime tab">
                  <input className="input font-mono" value={str('forward_url')} onChange={(e) => set('forward_url', e.target.value.trim())} placeholder="http://192.168.1.10:8081" />
                </Field>
                {num('forward_timeout_ms', 'Forward timeout (ms)', undefined, { min: 1000, max: 120000, step: 1000 })}
              </div>
            )}
            <PushInstructions network={{ ...network, adms_enabled: true, adms_port: Number(str('port')) || network.adms_port }} />
          </>
        )}

        {section === 'sync' && (
          <>
            <Toggle checked={bool('enabled')} onChange={(v) => set('enabled', v)} label="Automatic sync" hint="Off = only when you press “Sync now”. Pushed punches still arrive live." />
            <div className="grid gap-4 sm:grid-cols-2">
              {num('interval_seconds', 'Read devices every (seconds)', `= ${intervalLabel(Number(str('interval_seconds')) || 60)}. Minimum 60.`, { min: 60, max: 86400 })}
              {num('employees_minutes', 'Refresh employee list every (minutes)', undefined, { min: 1, max: 10080 })}
              {num('initial_days', 'First import: days of history', 'Only used the very first time a device is read', { min: 1, max: 3650 })}
              {num('lookback_hours', 'Look back (hours)', 'Each read re-checks this far back, to catch punches uploaded late', { min: 1, max: 720 })}
              {num('device_timeout_ms', 'Default device timeout (ms)', 'Used for new devices', { min: 1000, max: 120000, step: 1000 })}
            </div>
          </>
        )}

        {section === 'biotime' && (
          <>
            <Toggle
              checked={bool('enabled')}
              onChange={(v) => set('enabled', v)}
              label="Use a BioTime server"
              hint="Only if you run ZKTeco BioTime 8.5. Off = employees and punches come straight from your devices."
            />
            <div className={`grid gap-4 sm:grid-cols-2 ${bool('enabled') ? '' : 'opacity-60'}`}>
              <Field label="BioTime address" error={fields.url} hint="What you type in the browser to open BioTime">
                <input className="input font-mono" value={str('url')} onChange={(e) => set('url', e.target.value.trim())} placeholder="http://192.168.1.10:8081" />
              </Field>
              <Field label="Login type" error={fields.auth_type}>
                <select className="input" value={str('auth_type')} onChange={(e) => set('auth_type', e.target.value)}>
                  <option value="jwt">JWT (BioTime 8.x default)</option>
                  <option value="token">Token</option>
                </select>
              </Field>
              <Field label="Username" error={fields.username}>
                <input className="input" value={str('username')} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Password" error={fields.password} hint={bool('password_set') ? 'Saved. Leave empty to keep it.' : 'Not set yet'}>
                <input className="input" type="password" value={str('password')} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={bool('password_set') ? '••••••••' : ''} />
              </Field>
              {num('timeout_ms', 'Timeout (ms)', undefined, { min: 1000, max: 120000, step: 1000 })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-secondary" onClick={testBiotime} disabled={testing}>
                {testing ? <Spinner className="h-4 w-4" /> : <Icon name="wifi" className="h-4 w-4" />}
                Test connection
              </button>
              {testResult && <span className={`text-sm ${testResult.ok ? 'text-brand-700' : 'text-red-600'}`}>{testResult.message}</span>}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-3">
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <button type="button" className="btn-secondary" onClick={() => setForm(toForm(settings[section]))} disabled={!dirty || saving}>
          Undo
        </button>
        <button className="btn-primary" disabled={!dirty || saving}>
          {saving && <Spinner className="h-4 w-4 text-white" />}
          Save
        </button>
      </div>
    </form>
  );
}

function toForm(o: object): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'boolean' ? v : v === null || v === undefined ? '' : String(v);
  return out;
}
