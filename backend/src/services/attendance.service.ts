import { employeeName, employeesRepo, type Employee } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { HttpError, eachDate, isDate, localDate, parseLocalDateTime } from '../utils/http.js';

export type DayStatus = 'Present' | 'Missing punch' | 'Absent';

export interface DailyRow {
  emp_code: string;
  employee_name: string;
  department_name: string;
  date: string;
  first_punch: string | null;
  last_punch: string | null;
  punch_count: number;
  worked_minutes: number;
  status: DayStatus;
  terminals: string;
}

export interface DailyReportParams {
  startDate?: string;
  endDate?: string;
  empCode?: string;
  departmentId?: number;
  includeAbsent?: boolean;
}

const MAX_DAYS = 92;

/** Daily attendance from PostgreSQL: first/last punch, worked time, status. */
export async function buildDailyReport(p: DailyReportParams) {
  const startDate = p.startDate || localDate();
  const endDate = p.endDate || startDate;
  if (!isDate(startDate) || !isDate(endDate)) throw new HttpError(400, 'start_date and end_date must be YYYY-MM-DD');
  if (startDate > endDate) throw new HttpError(400, 'start_date must be on or before end_date');
  const days = eachDate(startDate, endDate);
  if (days.length > MAX_DAYS) throw new HttpError(400, `Date range is limited to ${MAX_DAYS} days`);

  const [employees, groups] = await Promise.all([
    employeesRepo.active(),
    punchesRepo.daily(`${startDate} 00:00:00`, `${endDate} 23:59:59`, p.empCode),
  ]);

  const byCode = new Map<string, Employee>(employees.map((e) => [e.empCode, e]));
  const inScope = (e: Employee | undefined) =>
    (!p.departmentId || e?.departmentId === p.departmentId) && (!p.empCode || e?.empCode === p.empCode);

  const rows: DailyRow[] = [];
  for (const g of groups) {
    const emp = byCode.get(g.emp_code);
    if (p.departmentId && !inScope(emp)) continue;
    const count = g.punch_count;
    const worked =
      count > 1
        ? Math.max(0, Math.round((parseLocalDateTime(g.last_punch).getTime() - parseLocalDateTime(g.first_punch).getTime()) / 60000))
        : 0;
    rows.push({
      emp_code: g.emp_code,
      employee_name: employeeName(emp),
      department_name: emp?.departmentName ?? '',
      date: g.date,
      first_punch: g.first_punch.slice(11, 19),
      last_punch: count > 1 ? g.last_punch.slice(11, 19) : null,
      punch_count: count,
      worked_minutes: worked,
      status: count > 1 ? 'Present' : 'Missing punch',
      terminals: g.terminals ?? '',
    });
  }

  if (p.includeAbsent) {
    const seen = new Set(rows.map((r) => `${r.emp_code}|${r.date}`));
    const active = employees.filter((e) => inScope(e) && e.enableAtt);
    const today = localDate();
    for (const date of days) {
      if (date > today) continue; // the future isn't "absent"
      for (const e of active) {
        if (e.hireDate && e.hireDate > date) continue; // not hired yet
        if (seen.has(`${e.empCode}|${date}`)) continue;
        rows.push({
          emp_code: e.empCode,
          employee_name: employeeName(e),
          department_name: e.departmentName ?? '',
          date,
          first_punch: null,
          last_punch: null,
          punch_count: 0,
          worked_minutes: 0,
          status: 'Absent',
          terminals: '',
        });
      }
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.emp_code.localeCompare(b.emp_code, undefined, { numeric: true }));

  return {
    summary: {
      start_date: startDate,
      end_date: endDate,
      days: days.length,
      rows: rows.length,
      present: rows.filter((r) => r.status === 'Present').length,
      missing_punch: rows.filter((r) => r.status === 'Missing punch').length,
      absent: rows.filter((r) => r.status === 'Absent').length,
      total_punches: rows.reduce((n, r) => n + r.punch_count, 0),
    },
    data: rows,
  };
}

export const minutesAsHours = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '');
