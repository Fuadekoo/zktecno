'use client';

/**
 * Organisation analytics on the dashboard: attendance over time, arrival times, weekdays, departments,
 * and who is absent, late or most regular. Data: GET /api/dashboard/analytics.
 *
 * Colours: present / late / absent use the fixed attendance status colours (validated set, always with a
 * legend + tooltip + table view); single-series charts use chart colour 1.
 */
import { AlertTriangle, CalendarCheck, CalendarX2, Clock3, Medal, Timer, TrendingDown, TrendingUp, Trophy, UserX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useLiveRefresh } from '@/components/realtime';
import { daysAgoISO, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useI18n, type TKey } from '@/lib/i18n';
import type { OrgUnit } from '@/lib/types';

// ---------------------------------------------------------------- data

interface PersonStat {
  emp_code: string;
  name: string;
  department: string;
  expected_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  attendance_rate: number;
  avg_first_in: string | null;
  avg_worked_minutes: number | null;
  last_seen: string | null;
}

interface Analytics {
  range: { start_date: string; end_date: string; work_start: string; grace_minutes: number };
  summary: {
    employees: number;
    working_days: number;
    attendance_rate: number;
    attendance_trend: number | null;
    punctuality_rate: number;
    late_arrivals: number;
    absences: number;
    avg_first_in: string | null;
    perfect_attendance: number;
  };
  daily: { date: string; weekday: string; expected: number; present: number; on_time: number; late: number; absent: number; rate: number }[];
  weekdays: { weekday: string; days: number; rate: number | null; late: number }[];
  arrival_times: { slot: string; count: number; late: boolean }[];
  departments: { department: string; employees: number; rate: number; late_rate: number; absent_days: number }[];
  most_absent: PersonStat[];
  most_late: PersonStat[];
  most_regular: PersonStat[];
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];
const PREFS_KEY = 'analytics-prefs';

type T = (key: TKey, vars?: Record<string, string | number>) => string;

const statusConfig = (t: T) =>
  ({
    on_time: { label: t('an.status.onTime'), color: 'var(--status-good)' },
    late: { label: t('an.status.late'), color: 'var(--status-warning)' },
    absent: { label: t('an.status.absent'), color: 'var(--status-critical)' },
  }) satisfies ChartConfig;
const rateConfig = (t: T) => ({ rate: { label: t('an.kpi.rate'), color: 'var(--chart-1)' } }) satisfies ChartConfig;
const arrivalConfig = (t: T) =>
  ({
    count: { label: t('an.arrivalsCount'), color: 'var(--chart-1)' },
    late: { label: t('an.afterStart'), color: 'var(--status-warning)' },
  }) satisfies ChartConfig;

/** Short date in the chosen language (e.g. 27 Nov). */
function useShortDate() {
  const { locale } = useI18n();
  return (d: string) => {
    try {
      return new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    } catch {
      return d.slice(5);
    }
  };
}
const dayKey = (w: string) => `day.${w}` as TKey;
const hours = (m: number | null) => (m === null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

// ---------------------------------------------------------------- page section

export function OrganizationAnalytics() {
  const { t } = useI18n();
  const shortDate = useShortDate();
  const [days, setDays] = useState('30');
  const [department, setDepartment] = useState('all');
  const [workStart, setWorkStart] = useState('08:30');
  const [grace, setGrace] = useState('10');

  // Remember the person's choices on this computer
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      if (p.days) setDays(p.days);
      if (p.workStart) setWorkStart(p.workStart);
      if (p.grace !== undefined) setGrace(String(p.grace));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ days, workStart, grace }));
  }, [days, workStart, grace]);

  const query = {
    start_date: daysAgoISO(Number(days) - 1),
    end_date: todayISO(),
    work_start: /^\d{2}:\d{2}$/.test(workStart) ? workStart : '08:30',
    grace: Number(grace) || 0,
    department: department === 'all' ? undefined : department,
  };
  const { data, error, loading, refresh } = useApi<Analytics>('/dashboard/analytics', query);
  const departments = useApi<{ data: OrgUnit[] }>('/departments/all');
  useLiveRefresh(['punches', 'employees', 'sync'], refresh, 3000);

  return (
    <section className="mt-10" aria-labelledby="analytics-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="analytics-title" className="text-lg font-semibold text-slate-900">
            {t('an.title')}
          </h2>
          <p className="text-sm text-slate-500">
            {data
              ? t('an.rangeInfo', { from: shortDate(data.range.start_date), to: shortDate(data.range.end_date), days: data.summary.working_days, people: data.summary.employees })
              : t('an.subtitle')}
          </p>
        </div>

        {/* Filters: one row above the charts */}
        <div className="flex flex-wrap items-end gap-2">
          <ToggleGroup type="single" variant="outline" value={days} onValueChange={(v) => v && setDays(v)} aria-label={t('an.title')}>
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className="px-3 text-xs">
                {t('an.days', { n: r.value })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-44 bg-white" aria-label={t('an.department')}>
              <SelectValue placeholder={t('an.allDepartments')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('an.allDepartments')}</SelectItem>
              {departments.data?.data.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {String(d.dept_name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600" title={t('an.workStartsTip')}>
            {t('an.workStarts')}
            <input type="time" className="w-[5.5rem] bg-transparent text-sm text-slate-900 outline-none" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600" title={t('an.graceTip')}>
            {t('an.grace')}
            <input type="number" min={0} max={240} className="w-10 bg-transparent text-sm text-slate-900 outline-none" value={grace} onChange={(e) => setGrace(e.target.value)} />
            {t('an.min')}
          </label>
        </div>
      </div>

      {error && !data ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-red-600">{t('an.loadFailed', { error })}</CardContent>
        </Card>
      ) : !data ? (
        <AnalyticsSkeleton />
      ) : data.summary.working_days === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarX2 className="mx-auto size-8 text-slate-400" />
            <p className="mt-3 font-medium text-slate-700">{t('an.noData')}</p>
            <p className="mt-1 text-sm text-slate-500">{t('an.noDataSub')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <Kpis a={data} />
          <DailyAttendance a={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ArrivalTimes a={data} />
            <Weekdays a={data} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <Leaderboard
              title={t('an.mostAbsent')}
              description={t('an.mostAbsentSub')}
              icon={<UserX className="size-4 text-red-600" />}
              people={data.most_absent}
              empty={t('an.mostAbsentEmpty')}
              metric={(p) => (p.absent_days === 1 ? t('an.dayN') : t('an.daysN', { n: p.absent_days }))}
              bar={(p) => (p.expected_days ? (p.absent_days / p.expected_days) * 100 : 0)}
              barClass="[&>div]:bg-status-critical"
              sub={(p) => `${t('an.attendancePct', { rate: p.attendance_rate })} · ${p.last_seen ? t('an.lastSeen', { date: shortDate(p.last_seen) }) : t('an.notSeen')}`}
            />
            <Leaderboard
              title={t('an.mostLate')}
              description={t('an.mostLateSub', { time: `${data.range.work_start}${data.range.grace_minutes ? ` + ${data.range.grace_minutes} ${t('an.min')}` : ''}` })}
              icon={<AlertTriangle className="size-4 text-amber-600" />}
              people={data.most_late}
              empty={t('an.mostLateEmpty')}
              metric={(p) => (p.late_days === 1 ? t('an.dayN') : t('an.daysN', { n: p.late_days }))}
              bar={(p) => (p.present_days ? (p.late_days / p.present_days) * 100 : 0)}
              barClass="[&>div]:bg-status-warning"
              sub={(p) => t('an.usuallyArrives', { time: p.avg_first_in ?? '—' })}
            />
            <Leaderboard
              title={t('an.mostRegular')}
              description={t('an.mostRegularSub')}
              icon={<Trophy className="size-4 text-brand-700" />}
              people={data.most_regular}
              empty={t('an.mostRegularEmpty')}
              metric={(p) => `${p.attendance_rate}%`}
              bar={(p) => p.attendance_rate}
              barClass="[&>div]:bg-status-good"
              sub={(p) => `${t('an.arrives', { time: p.avg_first_in ?? '—' })} · ${p.late_days ? t('an.lateN', { n: p.late_days }) : t('an.neverLate')} · ${t('an.works', { hours: hours(p.avg_worked_minutes) })}`}
              medal
            />
          </div>
          {data.departments.length > 1 && <Departments a={data} />}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- KPI tiles

function Kpi({ label, value, sub, icon, children }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; children?: ReactNode }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-1.5 text-xs font-medium">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums text-slate-900">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-slate-500">
        {sub}
        {children}
      </CardContent>
    </Card>
  );
}

function Kpis({ a }: { a: Analytics }) {
  const { t } = useI18n();
  const s = a.summary;
  const trend = s.attendance_trend;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi label={t('an.kpi.rate')} value={`${s.attendance_rate}%`} icon={<CalendarCheck className="size-3.5" />}>
        {trend === null ? (
          t('an.kpi.rateSub')
        ) : (
          <span className="inline-flex items-center gap-1">
            {trend >= 0 ? <TrendingUp className="size-3.5 text-green-700" /> : <TrendingDown className="size-3.5 text-red-600" />}
            <span className={trend >= 0 ? 'text-green-700' : 'text-red-600'}>
              {trend >= 0 ? '+' : ''}
              {trend} pts
            </span>
            {t('an.kpi.vsFirstHalf')}
          </span>
        )}
      </Kpi>
      <Kpi label={t('an.kpi.onTime')} value={`${s.punctuality_rate}%`} sub={t('an.kpi.onTimeSub')} icon={<Timer className="size-3.5" />} />
      <Kpi label={t('an.kpi.avgArrival')} value={s.avg_first_in ?? '—'} sub={t('an.kpi.workStartsAt', { time: a.range.work_start })} icon={<Clock3 className="size-3.5" />} />
      <Kpi label={t('an.kpi.late')} value={s.late_arrivals} sub={t('an.kpi.personDays')} icon={<AlertTriangle className="size-3.5" />} />
      <Kpi label={t('an.kpi.absences')} value={s.absences} sub={t('an.kpi.personDays')} icon={<UserX className="size-3.5" />} />
      <Kpi label={t('an.kpi.perfect')} value={s.perfect_attendance} sub={t('an.kpi.perfectSub')} icon={<Medal className="size-3.5" />} />
    </div>
  );
}

// ---------------------------------------------------------------- charts

function DailyAttendance({ a }: { a: Analytics }) {
  const { t } = useI18n();
  const shortDate = useShortDate();
  const rows = useMemo(() => a.daily.map((d) => ({ ...d, label: shortDate(d.date), day: t(dayKey(d.weekday)) })), [a.daily, shortDate, t]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('an.daily')}</CardTitle>
        <CardDescription>{t('an.dailySub')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="chart">
          <TabsList className="mb-3">
            <TabsTrigger value="chart">{t('an.chart')}</TabsTrigger>
            <TabsTrigger value="table">{t('an.table')}</TabsTrigger>
          </TabsList>
          <TabsContent value="chart">
            <ChartContainer config={statusConfig(t)} className="aspect-auto h-72 w-full">
              <BarChart data={rows} margin={{ left: -16, right: 8 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.4 }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) => {
                        const d = p?.[0]?.payload as (typeof rows)[number] | undefined;
                        return d ? `${d.day} ${d.label} · ${t('an.present', { rate: d.rate })}` : '';
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="on_time" stackId="a" fill="var(--color-on_time)" stroke="var(--card)" strokeWidth={1} />
                <Bar dataKey="late" stackId="a" fill="var(--color-late)" stroke="var(--card)" strokeWidth={1} />
                <Bar dataKey="absent" stackId="a" fill="var(--color-absent)" stroke="var(--card)" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </TabsContent>
          <TabsContent value="table">
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="table">
                <thead className="sticky top-0">
                  <tr>
                    <th>{t('an.col.date')}</th>
                    <th className="text-right">{t('an.col.expected')}</th>
                    <th className="text-right">{t('an.status.onTime')}</th>
                    <th className="text-right">{t('an.status.late')}</th>
                    <th className="text-right">{t('an.status.absent')}</th>
                    <th className="text-right">{t('an.col.attendance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>
                        {d.day} {d.label}
                      </td>
                      <td className="text-right tabular-nums">{d.expected}</td>
                      <td className="text-right tabular-nums">{d.on_time}</td>
                      <td className="text-right tabular-nums">{d.late}</td>
                      <td className="text-right tabular-nums">{d.absent}</td>
                      <td className="text-right font-medium tabular-nums">{d.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ArrivalTimes({ a }: { a: Analytics }) {
  const { t } = useI18n();
  const startSlot = a.range.work_start;
  const peak = a.arrival_times.reduce((m, x) => (x.count > m.count ? x : m), { slot: '', count: 0, late: false });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('an.arrivals')}</CardTitle>
        <CardDescription>
          {t('an.arrivalsSub')}
          {peak.count ? ` · ${t('an.busiest', { slot: peak.slot })}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={arrivalConfig(t)} className="aspect-auto h-64 w-full">
          <BarChart data={a.arrival_times} margin={{ left: -16, right: 8 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="slot" tickLine={false} axisLine={false} minTickGap={12} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <ChartTooltip
              cursor={{ fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, p) => {
                    const d = p?.[0]?.payload as Analytics['arrival_times'][number] | undefined;
                    return d ? `${d.slot}${d.late ? ` · ${t('an.afterStart')}` : ''}` : '';
                  }}
                />
              }
            />
            <ReferenceLine x={a.arrival_times.find((s) => s.slot >= startSlot)?.slot} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: t('an.start', { time: startSlot }), position: 'top', fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} name="count">
              {a.arrival_times.map((s) => (
                <Cell key={s.slot} fill={s.late ? 'var(--color-late)' : 'var(--color-count)'} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-1)' }} />
            {t('an.beforeStart')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: 'var(--status-warning)' }} />
            {t('an.afterStart')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Weekdays({ a }: { a: Analytics }) {
  const { t } = useI18n();
  const rows = a.weekdays.map((w) => ({ ...w, rate: w.rate ?? 0, day: t(dayKey(w.weekday)) }));
  const worst = rows.reduce((m, x) => (m === null || x.rate < m.rate ? x : m), null as (typeof rows)[number] | null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('an.weekday')}</CardTitle>
        <CardDescription>
          {t('an.weekdaySub')}
          {worst && rows.length > 1 ? ` · ${t('an.lowestOn', { day: worst.day })}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={rateConfig(t)} className="aspect-auto h-64 w-full">
          <BarChart data={rows} margin={{ left: -16, right: 8 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
            <ChartTooltip
              cursor={{ fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(v, _n, item) => {
                    const d = item.payload as (typeof rows)[number];
                    return <span className="tabular-nums">{t('an.weekdayTip', { rate: String(v), late: d.late, days: d.days })}</span>;
                  }}
                />
              }
            />
            <Bar dataKey="rate" fill="var(--color-rate)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function Departments({ a }: { a: Analytics }) {
  const { t } = useI18n();
  const rows = a.departments.slice(0, 12);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('an.departments')}</CardTitle>
        <CardDescription>{t('an.departmentsSub')}</CardDescription>
        <CardAction>
          <Badge variant="outline">{t('an.departmentsCount', { n: a.departments.length })}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={rateConfig(t)} className="aspect-auto w-full" style={{ height: Math.max(160, rows.length * 36 + 24) }}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 40 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="department" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 12 }} />
            <ChartTooltip
              cursor={{ fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(v, _n, item) => {
                    const d = item.payload as (typeof rows)[number];
                    return <span className="tabular-nums">{t('an.deptTip', { rate: String(v), late: d.late_rate, people: d.employees, absent: d.absent_days })}</span>;
                  }}
                />
              }
            />
            <Bar dataKey="rate" fill="var(--color-rate)" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: 'var(--foreground)', formatter: (v: unknown) => `${v}%` }} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- leaderboards

function Leaderboard({
  title,
  description,
  icon,
  people,
  empty,
  metric,
  bar,
  barClass,
  sub,
  medal,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  people: PersonStat[];
  empty: string;
  metric: (p: PersonStat) => string;
  bar: (p: PersonStat) => number;
  barClass: string;
  sub: (p: PersonStat) => string;
  medal?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{empty}</p>
        ) : (
          <ol className="space-y-3">
            {people.map((p, i) => (
              <li key={p.emp_code} className="flex items-center gap-3">
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    medal && i === 0 ? 'bg-amber-100 text-amber-800' : medal && i === 1 ? 'bg-slate-200 text-slate-700' : medal && i === 2 ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900" title={`${p.name} (${p.emp_code})`}>
                      {p.name}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{metric(p)}</span>
                  </div>
                  <Progress value={Math.min(100, bar(p))} className={`mt-1 h-1.5 ${barClass}`} />
                  <div className="mt-1 truncate text-[11px] text-slate-500">
                    {p.department ? `${p.department} · ` : ''}
                    {sub(p)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
