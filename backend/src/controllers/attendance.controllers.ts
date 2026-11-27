import type { Request, Response } from 'express';
import { punchesRepo, type Punch, type PunchFilters } from '../repositories/punches.js';
import { buildDailyReport, minutesAsHours, type DailyReportParams, type DailyRow } from '../services/attendance.service.js';
import { buildAnalytics } from '../services/analytics.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import { HttpError, pagination, sendCsv, str, toCsv, toDateTime } from '../utils/http.js';

function punchFilters(q: Request['query']): PunchFilters {
  const dept = Number(str(q.department));
  return {
    empCode: str(q.emp_code),
    terminalSn: str(q.terminal_sn),
    // punch_state=0 or punch_state=2,3 (several at once); only small numbers are valid states
    punchStates: (str(q.punch_state) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{1,3}$/.test(s)),
    search: str(q.search),
    departmentId: Number.isInteger(dept) && dept > 0 ? dept : undefined,
    from: toDateTime(str(q.start_time)),
    to: toDateTime(str(q.end_time), true),
  };
}

function reportParams(q: Request['query']): DailyReportParams {
  const dept = Number(str(q.department));
  return {
    startDate: str(q.start_date),
    endDate: str(q.end_date),
    empCode: str(q.emp_code),
    departmentId: Number.isInteger(dept) && dept > 0 ? dept : undefined,
    includeAbsent: ['true', '1'].includes(str(q.include_absent) ?? ''),
  };
}

export const dashboardController = {
  async get(_req: Request, res: Response) {
    res.json(await getDashboard());
  },

  /** Organisation analytics: ?start_date&end_date&work_start=08:30&grace=10&department=3 */
  async analytics(req: Request, res: Response) {
    const dept = Number(str(req.query.department));
    const grace = Number(str(req.query.grace));
    res.json(
      await buildAnalytics({
        startDate: str(req.query.start_date),
        endDate: str(req.query.end_date),
        workStart: str(req.query.work_start),
        graceMinutes: Number.isFinite(grace) ? grace : 0,
        departmentId: Number.isInteger(dept) && dept > 0 ? dept : undefined,
      }),
    );
  },
};

export const transactionsController = {
  async list(req: Request, res: Response) {
    const { pageSize, offset } = pagination(req.query, 25);
    const { count, data } = await punchesRepo.page(punchFilters(req.query), pageSize, offset);
    res.json({ count, hasNext: offset + data.length < count, hasPrevious: offset > 0, data });
  },

  async export(req: Request, res: Response) {
    const filters = punchFilters(req.query);
    if (!filters.from || !filters.to) throw new HttpError(400, 'start_time and end_time are required for export');
    const rows = await punchesRepo.all(filters);
    const csv = toCsv<Punch>(rows, [
      { label: 'Employee Code', value: 'emp_code' },
      { label: 'Name', value: 'employee_name' },
      { label: 'Department', value: 'department_name' },
      { label: 'Punch Time', value: 'punch_time' },
      { label: 'Punch State', value: 'punch_state_label' },
      { label: 'Verify Type', value: 'verify_type_label' },
      { label: 'Device SN', value: 'terminal_sn' },
      { label: 'Device', value: 'terminal_alias' },
      { label: 'Area', value: 'area_alias' },
    ]);
    sendCsv(res, `punches_${filters.from.slice(0, 10)}_to_${filters.to.slice(0, 10)}.csv`, csv);
  },
};

export const reportsController = {
  async daily(req: Request, res: Response) {
    res.json(await buildDailyReport(reportParams(req.query)));
  },

  async dailyExport(req: Request, res: Response) {
    const { summary, data } = await buildDailyReport(reportParams(req.query));
    const csv = toCsv<DailyRow>(data, [
      { label: 'Date', value: 'date' },
      { label: 'Employee Code', value: 'emp_code' },
      { label: 'Name', value: 'employee_name' },
      { label: 'Department', value: 'department_name' },
      { label: 'First Punch', value: 'first_punch' },
      { label: 'Last Punch', value: 'last_punch' },
      { label: 'Punches', value: 'punch_count' },
      { label: 'Worked (h:mm)', value: (r) => minutesAsHours(r.worked_minutes) },
      { label: 'Status', value: 'status' },
      { label: 'Devices', value: 'terminals' },
    ]);
    sendCsv(res, `attendance_${summary.start_date}_to_${summary.end_date}.csv`, csv);
  },
};
