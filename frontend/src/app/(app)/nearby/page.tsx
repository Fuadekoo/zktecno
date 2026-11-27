'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { deviceKey, FoundDeviceDetails, isReachable, RadarPanel, useDeviceScan, type DeviceScan, type FoundDevice } from '@/components/device-scan';
import { Icon } from '@/components/icons';
import { useLiveRefresh } from '@/components/realtime';
import { Alert, PageHeader, Spinner, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { DeviceMode, DeviceSetting, NetworkInfo, SettingsResponse, ZkDeviceStatus } from '@/lib/types';

const MODES: { id: DeviceMode; label: string; hint: string }[] = [
  { id: 'pull', label: 'Read over network', hint: 'This PC downloads users and punches from the device at every sync.' },
  { id: 'both', label: 'Read + live push', hint: 'Punches arrive live by push, and the PC also reads the device to catch anything missed.' },
  { id: 'push', label: 'Live push only', hint: 'The device sends each punch to this server. Set it up on the device under COMM. > Cloud Server.' },
];

/** 10.x, 172.16-31.x, 192.168.x: addresses only used inside a local network. */
const isPrivateIp = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** The best way to connect, from how the device was found. */
function suggestedMode(d: FoundDevice): DeviceMode {
  if (!d.via.includes('push')) return 'pull';
  return isReachable(d) ? 'both' : 'push';
}

export default function NearbyDevicesPage() {
  const { isAdmin } = useUser();
  const settings = useApi<SettingsResponse>(isAdmin ? '/settings' : null);
  useLiveRefresh(['device', 'punches'], settings.refresh, 1500);
  const scan = useDeviceScan();
  const [selected, setSelected] = useState<string | null>(null);
  const [extra, setExtra] = useState<FoundDevice[]>([]);
  const [remoteHost, setRemoteHost] = useState<string | null>(null);

  // Opened through a public address (e.g. a cloud server)? Then the server isn't on the person's Wi-Fi.
  useEffect(() => {
    const h = window.location.hostname;
    const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || isPrivateIp(h) || h.endsWith('.local') || !h.includes('.');
    setRemoteHost(local ? null : h);
  }, []);

  // Start searching as soon as the page opens
  useEffect(() => {
    if (isAdmin) void scan.scan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Devices found by IP (not by the search) are listed too, unless the search found them as well
  const devices = [...scan.devices, ...extra.filter((x) => !scan.devices.some((d) => d.ip === x.ip))];

  // Select the first device that isn't connected yet
  useEffect(() => {
    if (selected && devices.some((d) => deviceKey(d) === selected)) return;
    const pick = devices.find((d) => !d.added) ?? devices[0];
    if (pick) setSelected(deviceKey(pick));
  }, [devices, selected]);

  if (!isAdmin) return <Alert>Only administrators can add devices.</Alert>;

  const newCount = devices.filter((d) => !d.added).length;
  const saved = settings.data?.devices ?? [];

  return (
    <>
      <PageHeader
        title="Nearby Devices"
        description="Finds the ZKTeco / BioTime attendance devices on the same Wi-Fi or network as this server, and connects them in one click."
        actions={
          <Link href="/settings" className="btn-secondary">
            <Icon name="settings" className="h-4 w-4" />
            Manage devices
          </Link>
        }
      />

      {remoteHost && (
        <div className="mb-5">
          <Alert tone="warning">
            You’re using this app over the internet (<span className="font-mono">{remoteHost}</span>). The search runs on the server, so it only finds devices on the
            server’s own network, not on your Wi-Fi. To find devices in your office, run the app on a PC there (the desktop app). Or set each device to push to this
            server: on the device, open Menu &gt; COMM. &gt; Cloud Server Setting.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className="card p-5">
          <RadarPanel scan={scan} selected={selected} onSelect={setSelected} />
          {scan.error && (
            <div className="mt-4">
              <Alert onRetry={() => scan.scan(true)}>{scan.error}</Alert>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Devices found</h2>
                <p className="text-xs text-slate-500">Click a device, give it a name and press Connect.</p>
              </div>
              <span className="badge bg-brand-50 text-brand-700">
                {devices.length}
                {newCount > 0 && newCount !== devices.length ? ` · ${newCount} new` : ''}
              </span>
            </div>

            <div className="p-4">
              {devices.length === 0 ? (
                <EmptyFound scanning={scan.phase === 'scanning'} />
              ) : (
                <div className="flex flex-col gap-2">
                  {devices.map((d) => {
                    const key = deviceKey(d);
                    return (
                      <FoundCard
                        key={key}
                        d={d}
                        open={key === selected}
                        onOpen={() => setSelected(key)}
                        scan={scan}
                        settings={settings.data}
                        onConnected={(added) => {
                          scan.markAdded(key, added);
                          setExtra((list) => list.map((x) => (deviceKey(x) === key ? { ...x, added } : x)));
                          settings.reload();
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <ConnectByIp
            timeoutMs={settings.data?.settings.sync.device_timeout_ms ?? 10_000}
            savedDevices={saved}
            onFound={(d) => {
              setExtra((list) => [...list.filter((x) => x.ip !== d.ip), d]);
              setSelected(deviceKey(d));
            }}
          />

          {saved.length > 0 && <SavedDevices devices={saved} />}
        </div>
      </div>
    </>
  );
}

function EmptyFound({ scanning }: { scanning: boolean }) {
  if (scanning) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <Spinner className="h-6 w-6 text-brand-600" />
        <p className="mt-3 text-sm text-slate-600">Looking for devices…</p>
        <p className="mt-1 text-xs text-slate-500">Each device appears here the moment it answers. This takes about a minute.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon name="search" className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">No devices answered</p>
      <ul className="mx-auto mt-2 max-w-md space-y-1 text-left text-xs text-slate-500">
        <li>• Is the device switched on and connected to the same Wi-Fi or network as this server?</li>
        <li>• Check its IP address on the device: Menu &gt; COMM. &gt; Ethernet (or Wi-Fi), then use “Connect by IP address” below.</li>
        <li>• Is a Comm Key (communication password) set? Set it to 0 on the device.</li>
        <li>• Is this server in the cloud? Cloud servers can’t see devices on your local Wi-Fi. Set the device to push instead (COMM. &gt; Cloud Server Setting).</li>
      </ul>
    </div>
  );
}

type Step = 'idle' | 'testing' | 'saving' | 'failed';

/** One found device. When open: name, location and connection type, then Connect. */
function FoundCard({
  d,
  open,
  onOpen,
  scan,
  settings,
  onConnected,
}: {
  d: FoundDevice;
  open: boolean;
  onOpen: () => void;
  scan: DeviceScan;
  settings: SettingsResponse | null;
  onConnected: (added: { id: number; name: string }) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(d.model || `Device ${d.ip || d.serial_number}`);
  const [location, setLocation] = useState('');
  const [mode, setMode] = useState<DeviceMode>(suggestedMode(d));
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  /** The device answered the scan but not the connection test: offer to save it anyway */
  const [canForce, setCanForce] = useState(false);

  const reachable = isReachable(d);
  const busy = step === 'testing' || step === 'saving';
  const modes = MODES.filter((m) => (m.id === 'push' ? Boolean(d.serial_number) || d.via.includes('push') : reachable));

  async function save(serial: string | null) {
    setStep('saving');
    const created = await api<DeviceSetting>('/settings/devices', {
      method: 'POST',
      body: {
        name: name.trim(),
        mode,
        ip: d.ip || '',
        port: d.port,
        serial_number: serial ?? '',
        location: location.trim(),
        timeout_ms: settings?.settings.sync.device_timeout_ms ?? 10_000,
        chunk_size: '',
        enabled: true,
      },
    });
    toast(`${created.name} connected${mode !== 'push' ? '. Reading its users and punches now…' : ''}`);
    setStep('idle');
    onConnected({ id: created.id, name: created.name });
  }

  async function connect(e?: FormEvent, force = false) {
    e?.preventDefault();
    if (!name.trim()) {
      setNameError('Give the device a name');
      return;
    }
    setNameError(null);
    setError(null);
    setCanForce(false);
    // A device takes one connection at a time: pause the search while we talk to it
    const wasScanning = scan.phase === 'scanning';
    if (wasScanning && mode !== 'push') scan.pause();
    try {
      let serial = d.serial_number;
      if (mode !== 'push' && !force) {
        setStep('testing');
        const r = await api<ZkDeviceStatus>('/settings/devices/test', {
          method: 'POST',
          body: { ip: d.ip, port: d.port, timeout_ms: settings?.settings.sync.device_timeout_ms ?? 10_000 },
        });
        if (!r.online) {
          setStep('failed');
          setError(`The device didn’t answer: ${r.error}.`);
          setCanForce(mode === 'pull');
          return;
        }
        serial = r.serial_number || serial;
      }
      if (mode !== 'pull' && !serial) {
        setStep('failed');
        setError('The serial number is needed for push. Connect with “Read over network”, or add it from Settings with the serial number from the device (Menu > System Info).');
        return;
      }
      await save(serial);
    } catch (err) {
      setStep('failed');
      if (err instanceof ApiError && err.status === 409) setError('This device is already in your list (same serial number). Open “Manage devices” to edit it.');
      else if (err instanceof ApiError && err.fields?.name) setNameError(err.fields.name);
      else setError(err instanceof Error ? err.message : 'Couldn’t connect');
    } finally {
      if (wasScanning && mode !== 'push') void scan.scan(false);
    }
  }

  return (
    <div
      className={`radar-in rounded-xl border transition ${open ? 'border-brand-300 bg-brand-50/40 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
    >
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 p-3 text-left">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${d.added ? 'bg-slate-100 text-slate-500' : 'bg-brand-600 text-white'}`}>
          <Icon name={d.added ? 'check' : 'device'} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{d.model || 'ZKTeco device'}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">
            {d.ip ? `${d.ip}:${d.port}` : 'pushing to this server'}
            {d.serial_number ? ` · ${d.serial_number}` : ''}
          </div>
        </div>
        {d.added ? (
          <span className="badge bg-slate-100 text-slate-600">Connected</span>
        ) : d.error ? (
          <span className="badge bg-amber-50 text-amber-700">Busy</span>
        ) : (
          <span className="badge bg-brand-50 text-brand-700">New</span>
        )}
      </button>

      {open && (
        <div className="border-t border-brand-100 px-4 pb-4 pt-3">
          <FoundDeviceDetails d={d} />

          {d.added ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm">
              <span className="flex items-center gap-2 font-medium text-brand-700">
                <Icon name="check" className="h-4 w-4" />
                Connected as {d.added.name}
              </span>
              <Link href="/devices" className="btn-secondary py-1 text-xs">
                Open Devices
              </Link>
            </div>
          ) : (
            <form onSubmit={connect} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Name *</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Main gate" disabled={busy} />
                  {nameError && <span className="mt-1 block text-xs text-red-600">{nameError}</span>}
                </label>
                <label className="block">
                  <span className="label">Location</span>
                  <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={128} placeholder="e.g. Ground floor" disabled={busy} />
                </label>
              </div>

              {modes.length > 1 && (
                <div>
                  <span className="label">Connection</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {modes.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        disabled={busy}
                        onClick={() => setMode(m.id)}
                        className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                          mode === m.id ? 'border-brand-500 bg-white text-brand-800 ring-2 ring-brand-100' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{MODES.find((m) => m.id === mode)?.hint}</p>
                </div>
              )}

              {mode !== 'pull' && settings && <PushNote network={settings.network} />}

              {error && (
                <Alert>
                  <span className="block">{error}</span>
                  {canForce && (
                    <span className="mt-1 block text-xs">
                      If it’s busy or has a Comm Key set, fix that on the device and try again, or save it now and the server will keep retrying at each sync.
                    </span>
                  )}
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary min-w-36" disabled={busy}>
                  {busy ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="plus" className="h-4 w-4" />}
                  {step === 'testing' ? 'Testing connection…' : step === 'saving' ? 'Saving…' : step === 'failed' ? 'Try again' : 'Connect'}
                </button>
                {canForce && !busy && (
                  <button type="button" className="btn-secondary" onClick={() => connect(undefined, true)}>
                    Save anyway
                  </button>
                )}
                {step === 'testing' && <span className="text-xs text-slate-500">Talking to {d.ip}…</span>}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function PushNote({ network }: { network: NetworkInfo }) {
  if (!network.adms_enabled) {
    return <Alert tone="warning">Push (ADMS) is turned off, so this device’s pushes won’t be received. Turn it on in Settings &gt; Push (ADMS).</Alert>;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
      On the device, open <strong>Menu &gt; COMM. &gt; Cloud Server Setting</strong> and set server address{' '}
      <strong className="font-mono">{network.server_ips.join(' or ') || 'this PC’s IP address'}</strong>, port <strong className="font-mono">{network.adms_port}</strong>.
    </div>
  );
}

/** For a device the search didn't find (other subnet, or the search was stopped): test one address. */
function ConnectByIp({ timeoutMs, savedDevices, onFound }: { timeoutMs: number; savedDevices: DeviceSetting[]; onFound: (d: FoundDevice) => void }) {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('4370');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<ZkDeviceStatus>('/settings/devices/test', { method: 'POST', body: { ip: ip.trim(), port, timeout_ms: timeoutMs } });
      if (!r.online) {
        setError(`No device answered at ${ip}:${port}: ${r.error}. Check the IP on the device (Menu > COMM.), that it is on, and that its Comm Key is 0.`);
        return;
      }
      const existing = savedDevices.find((s) => (r.serial_number && s.serial_number === r.serial_number) || s.ip === r.ip);
      onFound({
        ip: r.ip,
        port: r.port,
        via: [r.connection ?? 'tcp'],
        serial_number: r.serial_number,
        model: r.device_name,
        firmware: r.firmware,
        user_count: r.user_count,
        log_count: r.log_count,
        error: null,
        last_push_at: null,
        added: existing ? { id: existing.id, name: existing.name } : null,
      });
      setIp('');
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.ip ? err.fields.ip : err instanceof Error ? err.message : 'Check failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">Device not listed? Connect by IP address</h2>
      <p className="mt-0.5 text-xs text-slate-500">Find the IP on the device: Menu &gt; COMM. &gt; Ethernet or Wi-Fi. Works for devices on another network this server can reach.</p>
      <form onSubmit={check} className="mt-3 flex flex-wrap items-start gap-2">
        <input className="input max-w-56 flex-1 font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.201" required disabled={busy} aria-label="IP address" />
        <input className="input w-24 font-mono" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} disabled={busy} aria-label="Port" />
        <button className="btn-primary" disabled={busy || !ip.trim()}>
          {busy ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="wifi" className="h-4 w-4" />}
          {busy ? 'Checking…' : 'Find device'}
        </button>
      </form>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </section>
  );
}

function SavedDevices({ devices }: { devices: DeviceSetting[] }) {
  return (
    <section className="card">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Already connected ({devices.length})</h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {devices.map((d) => (
          <li key={d.id} className={`flex items-center justify-between gap-3 px-5 py-2.5 text-sm ${d.enabled ? '' : 'opacity-50'}`}>
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800">{d.name}</div>
              <div className="truncate font-mono text-[11px] text-slate-500">{[d.ip && `${d.ip}:${d.port}`, d.serial_number].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <span className="shrink-0 text-xs text-slate-500">
              {d.last_seen_at ? `read ${timeAgo(d.last_seen_at)}` : d.last_push_at ? `push ${timeAgo(d.last_push_at)}` : 'not read yet'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
