'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { OrganizationAnalytics } from '@/components/analytics';
import { DeviceStatus, PunchBadge } from '@/components/badges';
import { Icon } from '@/components/icons';
import { useLiveRefresh } from '@/components/realtime';
import { useI18n } from '@/lib/i18n';
import { SyncButton } from '@/components/SyncButton';
import { Alert, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { intervalLabel, shortDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Dashboard } from '@/lib/types';

// New punches, device activity and finished syncs update the page live; this is only a safety net.
const REFRESH_MS = 60_000;

export default function DashboardPage() {
  const { isAdmin } = useUser();
  const { t, locale } = useI18n();
  const { data, error, loading, reload, refresh } = useApi<Dashboard>('/dashboard');
  useLiveRefresh(['punches', 'device', 'sync'], refresh);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <>
      <PageHeader
        title={t('dash.title')}
        description={data ? t('dash.today', { date: new Date(`${data.date}T00:00:00`).toLocaleDateString(locale, { dateStyle: 'full' }) }) : t('dash.overview')}
        actions={
          <>
            <button className="btn-secondary" onClick={reload} disabled={loading}>
              {loading ? <Spinner className="h-4 w-4" /> : <Icon name="refresh" className="h-4 w-4" />}
              {t('dash.refresh')}
            </button>
            <SyncButton onDone={reload} />
          </>
        }
      />

      {error && !data && (
        <div className="mb-6">
          <Alert onRetry={reload}>
            <p className="font-medium">{t('dash.loadFailed')}</p>
            <p className="mt-0.5">{error}</p>
          </Alert>
        </div>
      )}

      {data && <SyncNotice sync={data.sync} isAdmin={isAdmin} />}

      {!data && loading && (
        <div className="flex justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon="users" label={t('dash.presentToday')} value={data.today.present} sub={t('dash.ofEmployees', { n: data.employees.attendance_enabled })} />
            <StatCard icon="alert" tone="amber" label={t('dash.notPunched')} value={data.today.absent} sub={t('dash.notPunchedSub')} />
            <StatCard icon="clock" tone="sky" label={t('dash.punchesToday')} value={data.today.punches} />
            <StatCard
              icon="device"
              tone={data.devices.online < data.devices.total ? 'red' : 'brand'}
              label={t('dash.devicesOnline')}
              value={`${data.devices.online} / ${data.devices.total}`}
              sub={t('dash.atLastSync')}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <section className="card xl:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-900">{t('dash.latestPunches')}</h2>
                <Link href="/transactions" className="text-sm font-medium text-brand-700 hover:underline">
                  {t('dash.viewAll')}
                </Link>
              </div>
              {data.today.recent.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('dash.col.time')}</th>
                        <th>{t('dash.col.employee')}</th>
                        <th>{t('dash.col.state')}</th>
                        <th>{t('dash.col.verified')}</th>
                        <th>{t('dash.col.device')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.today.recent.map((t) => (
                        <tr key={t.id}>
                          <td className="tabular-nums">{t.punch_time.slice(11, 16)}</td>
                          <td>
                            <div className="font-medium text-slate-900">{t.employee_name || t.emp_code}</div>
                            <div className="text-xs text-slate-500">
                              {t.emp_code}
                              {t.department_name && ` · ${t.department_name}`}
                            </div>
                          </td>
                          <td>
                            <PunchBadge state={t.punch_state} label={t.punch_state_label} />
                          </td>
                          <td className="text-slate-600">{t.verify_type_label}</td>
                          <td className="text-slate-600">{t.terminal_alias || t.terminal_sn || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title={t('dash.noPunches')} hint={`Punches appear after the next sync (${intervalLabel(data.sync.interval_seconds)}).`} />
              )}
            </section>

            <section className="card">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-900">{t('dash.devices')}</h2>
                <Link href="/devices" className="text-sm font-medium text-brand-700 hover:underline">
                  {t('dash.liveStatus')}
                </Link>
              </div>
              {data.devices.list.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.devices.list.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{d.alias || d.sn}</p>
                        <p className="truncate text-xs text-slate-500">
                          {d.ip_address || 'No IP'} · last seen {shortDateTime(d.last_activity)}
                        </p>
                      </div>
                      <DeviceStatus state={d.state} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t('dash.noDevices')} hint="Devices appear after the first sync." />
              )}
            </section>
          </div>
        </>
      )}

      <OrganizationAnalytics />
    </>
  );
}

function SyncNotice({ sync, isAdmin }: { sync: Dashboard['sync']; isAdmin: boolean }) {
  if (sync.never_synced) {
    return (
      <div className="mb-6">
        <Alert tone="info">
          {sync.running
            ? 'The first sync from BioTime is running. Numbers fill in when it finishes.'
            : `No data has been synced from BioTime yet.${isAdmin ? ' Click “Sync now” to pull it immediately.' : ''}`}
        </Alert>
      </div>
    );
  }
  if (sync.last_error) {
    return (
      <div className="mb-6">
        <Alert tone="warning">
          The last sync from BioTime failed: {sync.last_error}. Showing data from {timeAgo(sync.last_success_at)}.{' '}
          <Link href="/system" className="font-medium underline">
            Details
          </Link>
        </Alert>
      </div>
    );
  }
  return (
    <p className="-mt-3 mb-5 flex items-center gap-2 text-xs text-slate-500">
      <span className={`h-2 w-2 rounded-full ${sync.running ? 'animate-pulse bg-amber-500' : 'bg-brand-500'}`} />
      {sync.running ? 'Syncing with BioTime…' : `Last synced ${timeAgo(sync.last_success_at)}`} · syncs {intervalLabel(sync.interval_seconds)}
    </p>
  );
}
