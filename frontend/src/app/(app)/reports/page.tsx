'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLiveRefresh } from '@/components/realtime';
import { PageHeader, Spinner, StatCard, TableState, useToast } from '@/components/ui';
import { download } from '@/lib/api';
import { daysAgoISO, minutesToHours, todayISO } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { DailyReport, DailyRow, OrgUnit } from '@/lib/types';

const STATUS_STYLE: Record<DailyRow['status'], string> = {
  Present: 'bg-brand-50 text-brand-700',
  'Missing punch': 'bg-amber-50 text-amber-700',
  Absent: 'bg-red-50 text-red-700',
};

export default function ReportsPage() {
  const toast = useToast();
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [department, setDepartment] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [includeAbsent, setIncludeAbsent] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | DailyRow['status']>('');
  const [exporting, setExporting] = useState(false);
  const debouncedEmp = useDebounced(empCode.trim());

  const query = { start_date: start, end_date: end, department, emp_code: debouncedEmp, include_absent: includeAbsent };
  const { data, error, loading, reload, refresh } = useApi<DailyReport>(start && end ? '/reports/daily' : null, query);
  useLiveRefresh(['punches', 'employees'], refresh, 1500);
  const departments = useApi<{ data: OrgUnit[] }>('/departments/all');

  const rows = useMemo(() => (data?.data ?? []).filter((r) => !statusFilter || r.status === statusFilter), [data, statusFilter]);

  async function exportCsv() {
    setExporting(true);
    try {
      await download('/reports/daily/export', query, 'attendance.csv');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Attendance Report"
        description="First and last punch per person per day, with worked hours and absences."
        actions={
          <button className="btn-primary" onClick={exportCsv} disabled={exporting || !data}>
            {exporting ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="download" className="h-4 w-4" />}
            Export CSV
          </button>
        }
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label>
          <span className="label">From</span>
          <input className="input" type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input className="input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          <span className="label">Department</span>
          <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.dept_name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Employee code</span>
          <input className="input" placeholder="Any" value={empCode} onChange={(e) => setEmpCode(e.target.value)} />
        </label>
        <label>
          <span className="label">Status</span>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="">All</option>
            <option>Present</option>
            <option>Missing punch</option>
            <option>Absent</option>
          </select>
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={includeAbsent} onChange={(e) => setIncludeAbsent(e.target.checked)} />
            Show absent
          </label>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 px-2 py-1.5" onClick={() => { setStart(todayISO()); setEnd(todayISO()); }}>
              Today
            </button>
            <button className="btn-secondary flex-1 px-2 py-1.5" onClick={() => { setStart(daysAgoISO(6)); setEnd(todayISO()); }}>
              Week
            </button>
          </div>
        </div>
      </div>

      {s && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon="check" label="Present" value={s.present} sub={`${s.days} day${s.days > 1 ? 's' : ''}`} />
          <StatCard icon="alert" tone="amber" label="Missing punch" value={s.missing_punch} sub="Only one punch that day" />
          <StatCard icon="users" tone="red" label="Absent" value={includeAbsent ? s.absent : '—'} sub={includeAbsent ? 'No punch at all' : 'Turn on “Show absent”'} />
          <StatCard icon="clock" tone="sky" label="Total punches" value={s.total_punches} />
        </div>
      )}

      <div className="card">
        <TableState loading={loading} error={error} empty={!rows.length} onRetry={reload} emptyTitle="No attendance records" emptyHint="Pick another date range or department.">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Department</th>
                <th>First punch</th>
                <th>Last punch</th>
                <th className="text-right">Punches</th>
                <th className="text-right">Worked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.emp_code}-${r.date}`}>
                  <td className="tabular-nums">{r.date}</td>
                  <td>
                    <div className="font-medium text-slate-900">{r.employee_name || '—'}</div>
                    <div className="text-xs text-slate-500">{r.emp_code}</div>
                  </td>
                  <td className="text-slate-600">{r.department_name || '—'}</td>
                  <td className="tabular-nums">{r.first_punch?.slice(0, 5) ?? '—'}</td>
                  <td className="tabular-nums">{r.last_punch?.slice(0, 5) ?? '—'}</td>
                  <td className="text-right tabular-nums">{r.punch_count}</td>
                  <td className="text-right tabular-nums">{minutesToHours(r.worked_minutes)}</td>
                  <td>
                    <span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
        {rows.length > 0 && <p className="px-4 py-3 text-sm text-slate-500">{rows.length.toLocaleString()} rows</p>}
      </div>
    </>
  );
}
