/**
 * Organisation analytics for the dashboard: attendance rate over time, who is absent or late most,
 * who is most regular, arrival times, weekdays and departments.
 *
 * Definitions (kept simple and explainable on the page):
 *  - Working day: a day in the range (up to today) on which at least one in-scope employee punched.
 *    Weekends and holidays nobody worked are skipped automatically.
 *  - Expected: employees with attendance on, not deleted, hired on or before the day.
 *  - Present: punched at least once that day. Absent: expected but no punch.
 *  - Late: first punch after the work start time plus the grace minutes.
 */
import { employeeName, employeesRepo } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { HttpError, eachDate, isDate, localDate } from '../utils/http.js';

export interface AnalyticsParams {
  startDate?: string;
  endDate?: string;
  /** HH:MM */
  workStart?: string;
  graceMinutes?: number;
  departmentId?: number;
}

const MAX_DAYS = 186;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMinutes = (hhmmss: string) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0) + (s ?? 0) / 60;
};
const asClock = (minutes: number | null) => {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

interface EmpStat {
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

export async function buildAnalytics(p: AnalyticsParams) {
  const today = localDate();
  const endDate = p.endDate || today;
  const startDate = p.startDate || (() => {
    const d = new Date(endDate + 'T00:00:00');
    d.setDate(d.getDate() - 29);
    return localDate(d);
  })();
  if (!isDate(startDate) || !isDate(endDate)) throw new HttpError(400, 'start_date and end_date must be YYYY-MM-DD');
  if (startDate > endDate) throw new HttpError(400, 'start_date must be on or before end_date');
  const allDays = eachDate(startDate, endDate);
  if (allDays.length > MAX_DAYS) throw new HttpError(400, `The range is limited to ${MAX_DAYS} days`);
  const workStart = /^\d{2}:\d{2}$/.test(p.workStart ?? '') ? p.workStart! : '08:30';
  const grace = Math.max(0, Math.min(240, p.graceMinutes ?? 0));
  const lateAfter = toMinutes(`${workStart}:00`) + grace;

  const [allEmployees, rows] = await Promise.all([
    employeesRepo.active(),
    punchesRepo.firstLastByDay(`${startDate} 00:00:00`, `${endDate} 23:59:59`),
  ]);
  const employees = allEmployees.filter((e) => e.enableAtt && (!p.departmentId || e.departmentId === p.departmentId));
  const byCode = new Map(employees.map((e) => [e.empCode, e]));
  const inScope = rows.filter((r) => byCode.has(r.emp_code));

  // Working days: days (up to today) with at least one in-scope punch
  const daysWithPunches = new Set(inScope.map((r) => r.date));
  const workDays = allDays.filter((d) => d <= today && daysWithPunches.has(d));

  // Punches by employee and day
  const day = new Map<string, (typeof rows)[number]>();
  for (const r of inScope) day.set(`${r.emp_code}|${r.date}`, r);

  const expectedOn = (code: string, d: string) => {
    const e = byCode.get(code)!;
    return !e.hireDate || e.hireDate <= d;
  };

  // ---- per day
  const daily = workDays.map((d) => {
    let expected = 0;
    let present = 0;
    let late = 0;
    for (const e of employees) {
      if (!expectedOn(e.empCode, d)) continue;
      expected++;
      const r = day.get(`${e.empCode}|${d}`);
      if (!r) continue;
      present++;
      if (toMinutes(r.first_in) > lateAfter) late++;
    }
    return { date: d, weekday: WEEKDAYS[new Date(`${d}T00:00:00`).getDay()]!, expected, present, on_time: present - late, late, absent: expected - present, rate: pct(present, expected) };
  });

  // ---- per employee
  const people: EmpStat[] = employees.map((e) => {
    let expected = 0;
    let present = 0;
    let late = 0;
    const firstIns: number[] = [];
    const worked: number[] = [];
    let lastSeen: string | null = null;
    for (const d of workDays) {
      if (!expectedOn(e.empCode, d)) continue;
      expected++;
      const r = day.get(`${e.empCode}|${d}`);
      if (!r) continue;
      present++;
      lastSeen = d;
      const first = toMinutes(r.first_in);
      firstIns.push(first);
      if (first > lateAfter) late++;
      if (r.n > 1) worked.push(toMinutes(r.last_out) - first);
    }
    const w = avg(worked);
    return {
      emp_code: e.empCode,
      name: employeeName(e) || e.empCode,
      department: e.departmentName ?? '',
      expected_days: expected,
      present_days: present,
      absent_days: expected - present,
      late_days: late,
      attendance_rate: pct(present, expected),
      avg_first_in: asClock(avg(firstIns)),
      avg_worked_minutes: w === null ? null : Math.round(w),
      last_seen: lastSeen,
    };
  });
  const counted = people.filter((x) => x.expected_days > 0);

  const mostAbsent = counted
    .filter((x) => x.absent_days > 0)
    .sort((a, b) => b.absent_days - a.absent_days || a.attendance_rate - b.attendance_rate || a.emp_code.localeCompare(b.emp_code, undefined, { numeric: true }))
    .slice(0, 10);
  const mostLate = counted
    .filter((x) => x.late_days > 0)
    .sort((a, b) => b.late_days - a.late_days || (b.avg_first_in ?? '').localeCompare(a.avg_first_in ?? ''))
    .slice(0, 10);
  // Most regular: best attendance, then fewest late days, then earliest average arrival
  const mostRegular = counted
    .filter((x) => x.present_days > 0)
    .sort((a, b) => b.attendance_rate - a.attendance_rate || a.late_days - b.late_days || (a.avg_first_in ?? '99').localeCompare(b.avg_first_in ?? '99'))
    .slice(0, 10);

  // ---- arrival times: first punch of each present day, in 30-minute slots
  const arrivals = new Map<number, number>();
  for (const d of workDays) {
    for (const e of employees) {
      const r = day.get(`${e.empCode}|${d}`);
      if (!r) continue;
      const slot = Math.floor(toMinutes(r.first_in) / 30) * 30;
      arrivals.set(slot, (arrivals.get(slot) ?? 0) + 1);
    }
  }
  const slots = [...arrivals.keys()].sort((a, b) => a - b);
  const arrivalTimes = slots.length
    ? Array.from({ length: (slots[slots.length - 1]! - slots[0]!) / 30 + 1 }, (_, i) => {
        const s = slots[0]! + i * 30;
        return { slot: asClock(s)!, count: arrivals.get(s) ?? 0, late: s + 15 > lateAfter };
      })
    : [];

  // ---- weekdays (Mon..Sun order)
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((w) => {
      const ds = daily.filter((x) => x.weekday === w);
      return { weekday: w, days: ds.length, rate: ds.length ? pct(ds.reduce((a, x) => a + x.present, 0), ds.reduce((a, x) => a + x.expected, 0)) : null, late: ds.reduce((a, x) => a + x.late, 0) };
    })
    .filter((x) => x.days > 0);

  // ---- departments
  const deptMap = new Map<string, EmpStat[]>();
  for (const x of counted) {
    const k = x.department || 'No department';
    deptMap.set(k, [...(deptMap.get(k) ?? []), x]);
  }
  const departments = [...deptMap.entries()]
    .map(([name, list]) => {
      const expected = list.reduce((a, x) => a + x.expected_days, 0);
      const present = list.reduce((a, x) => a + x.present_days, 0);
      const late = list.reduce((a, x) => a + x.late_days, 0);
      return { department: name, employees: list.length, rate: pct(present, expected), late_rate: pct(late, present), absent_days: expected - present };
    })
    .sort((a, b) => b.rate - a.rate);

  // ---- headline numbers
  const totals = daily.reduce((a, x) => ({ expected: a.expected + x.expected, present: a.present + x.present, late: a.late + x.late }), { expected: 0, present: 0, late: 0 });
  const workSet = new Set(workDays);
  const allFirstIns = inScope.filter((r) => workSet.has(r.date)).map((r) => toMinutes(r.first_in));
  const prevHalf = daily.slice(0, Math.floor(daily.length / 2));
  const lastHalf = daily.slice(Math.floor(daily.length / 2));
  const rateOf = (ds: typeof daily) => pct(ds.reduce((a, x) => a + x.present, 0), ds.reduce((a, x) => a + x.expected, 0));

  return {
    range: { start_date: startDate, end_date: endDate, work_start: workStart, grace_minutes: grace },
    summary: {
      employees: employees.length,
      working_days: workDays.length,
      attendance_rate: pct(totals.present, totals.expected),
      // Change between the first and second half of the range (percentage points)
      attendance_trend: daily.length >= 4 ? Math.round((rateOf(lastHalf) - rateOf(prevHalf)) * 10) / 10 : null,
      punctuality_rate: pct(totals.present - totals.late, totals.present),
      late_arrivals: totals.late,
      absences: totals.expected - totals.present,
      avg_first_in: asClock(avg(allFirstIns)),
      perfect_attendance: counted.filter((x) => x.absent_days === 0 && x.late_days === 0 && x.present_days > 0).length,
    },
    daily,
    weekdays,
    arrival_times: arrivalTimes,
    departments,
    most_absent: mostAbsent,
    most_late: mostLate,
    most_regular: mostRegular,
  };
}
