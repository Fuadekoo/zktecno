'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { SyncButton } from '@/components/SyncButton';
import { Alert, PageHeader, Pagination, Spinner, StatCard, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, type Paginated } from '@/lib/api';
import { daysAgoISO, intervalLabel, timeAgo, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AuditEntry, SyncJobName, SyncResult, SyncRunRow, SystemStatus, ZkDeviceStatus } from '@/lib/types';

const JOB_LABEL: Record<SyncJobName, string> = { punches: 'Punches', employees: 'Employees', devices: 'Devices', device_punches: 'Punches (direct from devices)' };
const AUDIT_PAGE = 25;
const RUNS_PAGE = 15;
const TRIGGER_LABEL: Record<SyncRunRow['trigger'], string> = { startup: 'Startup', schedule: 'Scheduled', manual: 'Manual', personnel_change: 'After edit', range: 'Re-import' };

export default function SystemPage() {
  const { isAdmin } = useUser();
  const toast = useToast();
  const status = useApi<SystemStatus>('/system/status');
  const [auditPage, setAuditPage] = useState(1);
  const audit = useApi<Paginated<AuditEntry>>(isAdmin ? '/system/audit' : null, { page: auditPage, page_size: AUDIT_PAGE });

  const [runsPage, setRunsPage] = useState(1);
  const [runsJob, setRunsJob] = useState('');
  const runs = useApi<Paginated<SyncRunRow>>('/system/sync-runs', { page: runsPage, page_size: RUNS_PAGE, job: runsJob });

  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState(daysAgoISO(6));
  const [rangeEnd, setRangeEnd] = useState(todayISO());
  const [rangeSource, setRangeSource] = useState<'punches' | 'device_punches'>('punches');
  const [zkDevices, setZkDevices] = useState<ZkDeviceStatus[] | null>(null);
  const [zkChecking, setZkChecking] = useState(false);

  async function checkDevices() {
    setZkChecking(true);
    try {
      setZkDevices((await api<{ enabled: boolean; devices: ZkDeviceStatus[] }>('/system/zk-devices')).devices);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not check devices', 'error');
    } finally {
      setZkChecking(false);
    }
  }

  async function sync(body: Record<string, string>, key: string) {
    setBusyJob(key);
    try {
      const r = await api<SyncResult>('/system/sync', { method: 'POST', body });
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast(failed.map((f) => `${f.job}: ${f.error}`).join('; '), 'error');
      else toast(`Done: ${r.results.map((x) => `${x.count} ${x.job}`).join(', ')}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setBusyJob(null);
      status.reload();
      audit.reload();
      runs.reload();
    }
  }

  const s = status.data;
  const hasDirect = Boolean(s?.direct_devices?.length);
  const jobNames: SyncJobName[] = hasDirect ? ['punches', 'device_punches', 'employees', 'devices'] : ['punches', 'employees', 'devices'];

  return (
    <>
      <PageHeader
        title="Sync & Activity"
        description="Punches arrive from your devices (live push and scheduled reads) and are saved in MySQL. Reports and punch logs read from MySQL."
        actions={
          <>
            <button className="btn-secondary" onClick={status.reload} disabled={status.loading}>
              <Icon name="refresh" className="h-4 w-4" />
              Refresh
            </button>
            <SyncButton
              label="Sync everything now"
              onDone={() => {
                status.reload();
                audit.reload();
                runs.reload();
              }}
            />
          </>
        }
      />

      {status.error && (
        <div className="mb-6">
          <Alert onRetry={status.reload}>{status.error}</Alert>
        </div>
      )}
      {!s && status.loading && (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      )}

      {s && (
        <>
          {!s.sync.enabled && (
            <div className="mb-4">
              <Alert tone="warning">Automatic sync is turned off (SYNC_ENABLED=false). Data only updates when you click “Sync”.</Alert>
            </div>
          )}

          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon="clock" label="Punches stored" value={s.totals.punches.toLocaleString()} sub={s.totals.first_punch ? `Since ${s.totals.first_punch.slice(0, 10)}` : 'None yet'} />
            <StatCard icon="users" tone="sky" label="Employees" value={s.totals.employees} />
            <StatCard icon="device" tone="sky" label="Devices" value={s.totals.devices} />
            <StatCard
              icon="database"
              tone="amber"
              label="Schedule"
              value={<span className="text-lg">{s.sync.enabled ? intervalLabel(s.sync.interval_seconds) : 'Off'}</span>}
              sub={`Employees every ${s.sync.employees_minutes} min`}
            />
          </div>

          <section className="card mb-6">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Sync jobs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Last success</th>
                    <th className="text-right">Records last run</th>
                    <th className="text-right">Runs</th>
                    <th>Last error</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {jobNames.map((name) => {
                    const j = s.sync.jobs.find((x) => x.job === name);
                    const running = j?.is_running || busyJob === name;
                    return (
                      <tr key={name}>
                        <td className="font-medium text-slate-900">{JOB_LABEL[name]}</td>
                        <td>
                          {running ? (
                            <span className="badge bg-amber-50 text-amber-700">Running</span>
                          ) : !j ? (
                            <span className="badge bg-slate-100 text-slate-600">Never run</span>
                          ) : j.last_error ? (
                            <span className="badge bg-red-50 text-red-700">Failed</span>
                          ) : (
                            <span className="badge bg-brand-50 text-brand-700">OK</span>
                          )}
                        </td>
                        <td title={j?.last_success_at ?? ''}>{timeAgo(j?.last_success_at)}</td>
                        <td className="text-right tabular-nums">{j?.last_count ?? '—'}</td>
                        <td className="text-right tabular-nums">{j?.total_runs ?? 0}</td>
                        <td className="max-w-md truncate text-red-700" title={j?.last_error ?? ''}>
                          {j?.last_error || '—'}
                        </td>
                        {isAdmin && (
                          <td className="text-right">
                            <button className="btn-secondary px-3 py-1.5" disabled={Boolean(busyJob)} onClick={() => sync({ job: name }, name)}>
                              {busyJob === name ? <Spinner className="h-4 w-4" /> : 'Sync'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {hasDirect && s.direct_devices && (
            <section className="card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Devices read directly</h2>
                  <p className="text-sm text-slate-500">
                    Punches are also read straight from these devices (ZK_DEVICES), alongside BioTime. Duplicates are merged.
                  </p>
                </div>
                <button className="btn-secondary" onClick={checkDevices} disabled={zkChecking}>
                  {zkChecking ? <Spinner className="h-4 w-4" /> : <Icon name="refresh" className="h-4 w-4" />}
                  Check devices
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Status</th>
                      <th>Serial / name</th>
                      <th>Device time</th>
                      <th className="text-right">Users</th>
                      <th className="text-right">Logs</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.direct_devices.map((addr) => {
                      const d = zkDevices?.find((x) => `${x.ip}:${x.port}` === addr);
                      return (
                        <tr key={addr}>
                          <td className="font-mono">{addr}</td>
                          <td>
                            {!d ? (
                              <span className="badge bg-slate-100 text-slate-600">Not checked</span>
                            ) : d.online ? (
                              <span className="badge bg-brand-50 text-brand-700">
                                Online ({d.connection?.toUpperCase()}, {d.latency_ms} ms)
                              </span>
                            ) : (
                              <span className="badge bg-red-50 text-red-700">Offline</span>
                            )}
                          </td>
                          <td>{d ? [d.serial_number, d.device_name].filter(Boolean).join(' · ') || '—' : '—'}</td>
                          <td className="tabular-nums">{d?.device_time ?? '—'}</td>
                          <td className="text-right tabular-nums">{d?.user_count ?? '—'}</td>
                          <td className="text-right tabular-nums">{d?.log_count ?? '—'}</td>
                          <td className="max-w-md truncate text-red-700" title={d?.error ?? ''}>
                            {d?.error || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {s.adms?.enabled && (
            <section className="card mb-6">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Devices pushing (ADMS)</h2>
                <p className="text-sm text-slate-500">
                  Devices send punches to port {s.adms.port}. Punches are saved right away
                  {s.adms.forward_to ? <> and forwarded to BioTime at <span className="font-mono">{s.adms.forward_to}</span></> : ' (standalone, not forwarded to BioTime)'}.
                </p>
              </div>
              <TableState loading={false} error={null} empty={!s.adms.devices.length} emptyTitle="No device has connected since the backend started">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>IP</th>
                      <th>Last seen</th>
                      <th>Last punches</th>
                      <th className="text-right">Received</th>
                      <th className="text-right">New</th>
                      <th>BioTime</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.adms.devices.map((d) => (
                      <tr key={d.sn}>
                        <td className="font-mono">
                          {d.sn}
                          {!d.allowed && d.last_attlog_at && <span className="badge ml-2 bg-amber-50 text-amber-700">not allowed</span>}
                        </td>
                        <td className="font-mono text-xs">{d.ip ?? '—'}</td>
                        <td title={d.last_seen}>{timeAgo(d.last_seen)}</td>
                        <td title={d.last_attlog_at ?? ''}>{d.last_attlog_at ? timeAgo(d.last_attlog_at) : '—'}</td>
                        <td className="text-right tabular-nums">{d.punches_received}</td>
                        <td className="text-right tabular-nums">{d.punches_saved}</td>
                        <td>
                          {!s.adms.forward_to ? (
                            '—'
                          ) : d.last_forward_status === null ? (
                            <span className="badge bg-red-50 text-red-700">Unreachable</span>
                          ) : (
                            <span className={`badge ${d.last_forward_status < 400 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>{d.last_forward_status}</span>
                          )}
                        </td>
                        <td className="max-w-md truncate text-red-700" title={d.last_error ?? ''}>
                          {d.last_error || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableState>
            </section>
          )}

          <section className="card mb-6">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Sync history</h2>
                <p className="text-sm text-slate-500">Every sync run saved in the database: what was read and what was new.</p>
              </div>
              <select className="input w-40" value={runsJob} onChange={(e) => { setRunsJob(e.target.value); setRunsPage(1); }}>
                <option value="">All jobs</option>
                <option value="punches">Punches</option>
                <option value="employees">Employees</option>
                <option value="devices">Devices</option>
                {hasDirect && <option value="device_punches">Punches (direct)</option>}
              </select>
            </div>
            <TableState loading={runs.loading} error={runs.error} empty={!runs.data?.data.length} onRetry={runs.reload} emptyTitle="No sync runs yet">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Started</th>
                    <th>Job</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th className="text-right">Read</th>
                    <th className="text-right">New</th>
                    <th className="text-right">Removed</th>
                    <th className="text-right">Webhooks</th>
                    <th className="text-right">Time</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.data.map((r) => (
                    <tr key={r.id}>
                      <td className="text-xs text-slate-500">{r.id}</td>
                      <td className="tabular-nums">{r.started_at}</td>
                      <td>{JOB_LABEL[r.job]}</td>
                      <td className="text-slate-600">{TRIGGER_LABEL[r.trigger]}</td>
                      <td>
                        <span className={`badge ${r.status === 'success' ? 'bg-brand-50 text-brand-700' : r.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{r.status}</span>
                      </td>
                      <td className="text-right tabular-nums">{r.fetched}</td>
                      <td className="text-right tabular-nums font-medium">{r.created || '—'}</td>
                      <td className="text-right tabular-nums">{r.removed || '—'}</td>
                      <td className="text-right tabular-nums">{r.webhooks_queued || '—'}</td>
                      <td className="text-right tabular-nums text-slate-500">{r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="max-w-xs truncate text-xs" title={r.error ?? (r.range_from ? `${r.range_from} → ${r.range_to}` : '')}>
                        {r.error ? <span className="text-red-700">{r.error}</span> : r.range_from ? <span className="text-slate-500">{r.range_from.slice(0, 16)} → {r.range_to?.slice(0, 16)}</span> : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableState>
            {runs.data && runs.data.count > RUNS_PAGE && <Pagination page={runsPage} pageSize={RUNS_PAGE} count={runs.data.count} onPage={setRunsPage} />}
          </section>

          {isAdmin && (
            <section className="card mb-6 p-5">
              <h2 className="font-semibold text-slate-900">Re-import punches for a date range</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use this if a device was offline and uploaded old punches later, or to import history older than the first sync. Existing punches are
                updated, never duplicated.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label>
                  <span className="label">From</span>
                  <input className="input" type="date" value={rangeStart} max={rangeEnd} onChange={(e) => setRangeStart(e.target.value)} />
                </label>
                <label>
                  <span className="label">To</span>
                  <input className="input" type="date" value={rangeEnd} min={rangeStart} onChange={(e) => setRangeEnd(e.target.value)} />
                </label>
                {hasDirect && (
                  <label>
                    <span className="label">From source</span>
                    <select className="input" value={rangeSource} onChange={(e) => setRangeSource(e.target.value as typeof rangeSource)}>
                      <option value="punches">BioTime</option>
                      <option value="device_punches">Devices directly</option>
                    </select>
                  </label>
                )}
                <button
                  className="btn-primary"
                  disabled={Boolean(busyJob) || !rangeStart || !rangeEnd}
                  onClick={() => sync({ job: hasDirect ? rangeSource : 'punches', start_date: rangeStart, end_date: rangeEnd }, 'range')}
                >
                  {busyJob === 'range' && <Spinner className="h-4 w-4 text-white" />}
                  Re-import
                </button>
              </div>
            </section>
          )}

          <section className="card mb-6 grid gap-4 p-5 text-sm sm:grid-cols-2">
            <div>
              <p className="label">BioTime server</p>
              <p className="font-mono">{s.biotime.server}</p>
              <p className="text-slate-500">
                User {s.biotime.user} · {s.biotime.auth_type.toUpperCase()} auth
              </p>
            </div>
            <div>
              <p className="label">MySQL database</p>
              <p className="font-mono">
                {s.database.host}:{s.database.port}/{s.database.name}
              </p>
            </div>
          </section>
        </>
      )}

      {isAdmin && (
        <section className="card">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Activity log</h2>
            <p className="text-sm text-slate-500">Who signed in and what they changed.</p>
          </div>
          <TableState loading={audit.loading} error={audit.error} empty={!audit.data?.data.length} onRetry={audit.reload} emptyTitle="No activity yet">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.data.map((a) => (
                  <tr key={a.id}>
                    <td className="tabular-nums" title={a.created_at}>
                      {a.created_at}
                    </td>
                    <td>{a.username || '—'}</td>
                    <td>
                      <span
                        className={`badge ${
                          a.action === 'delete' || a.action === 'login_failed'
                            ? 'bg-red-50 text-red-700'
                            : a.action === 'create'
                              ? 'bg-brand-50 text-brand-700'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {a.action.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="max-w-lg truncate text-slate-600" title={a.summary ?? ''}>
                      {a.summary || `${a.entity} ${a.entity_id ?? ''}`}
                    </td>
                    <td className="text-xs text-slate-500">{a.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableState>
          {audit.data && audit.data.count > AUDIT_PAGE && <Pagination page={auditPage} pageSize={AUDIT_PAGE} count={audit.data.count} onPage={setAuditPage} />}
        </section>
      )}
    </>
  );
}
