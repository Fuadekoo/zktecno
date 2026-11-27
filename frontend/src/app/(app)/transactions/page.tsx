'use client';

import { useState } from 'react';
import { PunchBadge } from '@/components/badges';
import { Icon } from '@/components/icons';
import { useLive, useLiveRefresh } from '@/components/realtime';
import { PageHeader, Pagination, Spinner, TableState, useToast } from '@/components/ui';
import { download, type Paginated } from '@/lib/api';
import { daysAgoISO, todayISO } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Device, OrgUnit, Transaction } from '@/lib/types';

const PAGE_SIZE = 25;

export default function TransactionsPage() {
  const toast = useToast();
  const [empCode, setEmpCode] = useState('');
  const [terminal, setTerminal] = useState('');
  const [department, setDepartment] = useState('');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const debouncedEmp = useDebounced(empCode.trim());

  const filters = { search: debouncedEmp, department, terminal_sn: terminal, start_time: start, end_time: end };
  const { data, error, loading, reload, refresh } = useApi<Paginated<Transaction>>('/transactions', { ...filters, page, page_size: PAGE_SIZE });
  useLiveRefresh('punches', refresh);
  // Highlight punches that just arrived
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useLive('punches', (e) => {
    if (!e.live) return;
    const ids = e.punches.map((p) => p.id);
    setFresh((s) => new Set([...s, ...ids]));
    setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !ids.includes(id)))), 6000);
  });
  const devices = useApi<{ data: Device[] }>('/devices/all');
  const departments = useApi<{ data: OrgUnit[] }>('/departments/all');

  const update = (fn: () => void) => {
    fn();
    setPage(1);
  };

  async function exportCsv() {
    setExporting(true);
    try {
      await download('/transactions/export', filters, 'transactions.csv');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Punch Logs"
        description="Every check-in and check-out from your devices."
        actions={
          <>
            <button className="btn-secondary" onClick={reload} disabled={loading}>
              <Icon name="refresh" className="h-4 w-4" />
              Refresh
            </button>
            <button className="btn-primary" onClick={exportCsv} disabled={exporting || !start || !end}>
              {exporting ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="download" className="h-4 w-4" />}
              Export CSV
            </button>
          </>
        }
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label>
          <span className="label">Employee</span>
          <input className="input" placeholder="Code or name" value={empCode} onChange={(e) => update(() => setEmpCode(e.target.value))} />
        </label>
        <label>
          <span className="label">Department</span>
          <select className="input" value={department} onChange={(e) => update(() => setDepartment(e.target.value))}>
            <option value="">All departments</option>
            {departments.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.dept_name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Device</span>
          <select className="input" value={terminal} onChange={(e) => update(() => setTerminal(e.target.value))}>
            <option value="">All devices</option>
            {devices.data?.data.map((d) => (
              <option key={d.id} value={d.sn}>
                {d.alias || d.sn}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input className="input" type="date" value={start} max={end || undefined} onChange={(e) => update(() => setStart(e.target.value))} />
        </label>
        <label>
          <span className="label">To</span>
          <input className="input" type="date" value={end} min={start || undefined} onChange={(e) => update(() => setEnd(e.target.value))} />
        </label>
        <div className="flex items-end gap-2">
          {[
            ['Today', 0],
            ['7 days', 6],
            ['30 days', 29],
          ].map(([label, days]) => (
            <button
              key={label}
              className="btn-secondary flex-1 px-2"
              onClick={() =>
                update(() => {
                  setStart(daysAgoISO(days as number));
                  setEnd(todayISO());
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <TableState
          loading={loading}
          error={error}
          empty={!data?.data.length}
          onRetry={reload}
          emptyTitle="No punches found"
          emptyHint="Try a wider date range or clear the filters."
        >
          <table className="table">
            <thead>
              <tr>
                <th>Date & time</th>
                <th>Employee</th>
                <th>Department</th>
                <th>State</th>
                <th>Verified by</th>
                <th>Device</th>
                <th>Area</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((t) => (
                <tr key={t.id} className={fresh.has(t.id) ? 'live-new' : undefined}>
                  <td className="tabular-nums">{t.punch_time}</td>
                  <td>
                    <div className="font-medium text-slate-900">{t.employee_name || '—'}</div>
                    <div className="text-xs text-slate-500">{t.emp_code}</div>
                  </td>
                  <td className="text-slate-600">{t.department_name || '—'}</td>
                  <td>
                    <PunchBadge state={t.punch_state} label={t.punch_state_label} />
                  </td>
                  <td className="text-slate-600">{t.verify_type_label}</td>
                  <td className="text-slate-600">{t.terminal_alias || t.terminal_sn || '—'}</td>
                  <td className="text-slate-600">{t.area_alias || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
        {data && data.count > 0 && <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />}
      </div>
    </>
  );
}
