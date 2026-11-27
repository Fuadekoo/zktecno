/**
 * Employee Excel import: the template (columns, drop-downs, instructions) and reading a filled-in file into
 * validated rows. No React here, so it can be tested on its own.
 */
import type { Workbook } from 'exceljs';
import type { OrgUnit } from './types';

// ---------------------------------------------------------------- template columns

type Col = { key: string; header: string; width: number; required?: boolean; note: string };

export const COLUMNS: Col[] = [
  { key: 'emp_code', header: 'Employee code', width: 16, required: true, note: 'Unique ID, also the user ID on the device. Letters and numbers only, up to 20.' },
  { key: 'first_name', header: 'First name', width: 18, required: true, note: 'Up to 25 characters. The device shows first + last name.' },
  { key: 'last_name', header: 'Last name', width: 18, note: 'Up to 25 characters.' },
  { key: 'department', header: 'Department', width: 22, note: 'Pick from the list (department name or code).' },
  { key: 'position', header: 'Position', width: 20, note: 'Pick from the list (optional).' },
  { key: 'area', header: 'Area', width: 18, note: 'Pick from the list (optional). Devices in this area get the person (BioTime).' },
  { key: 'card_no', header: 'Card number', width: 14, note: 'RFID card number (optional).' },
  { key: 'device_password', header: 'Device password', width: 15, note: 'PIN for the device keypad, up to 8 digits (optional).' },
  { key: 'privilege', header: 'Device role', width: 18, note: 'Employee, Enroller, Administrator or Super administrator. Empty = Employee.' },
  { key: 'hire_date', header: 'Hire date', width: 13, note: 'A date (e.g. 2026-01-15). Not counted absent before this date.' },
  { key: 'gender', header: 'Gender', width: 10, note: 'M or F (optional).' },
  { key: 'mobile', header: 'Mobile', width: 15, note: 'Phone number (optional).' },
  { key: 'email', header: 'Email', width: 24, note: 'Email address (optional).' },
  { key: 'enable_att', header: 'Attendance', width: 12, note: 'Yes = counted in attendance reports (default). No = not counted.' },
];

export const PRIVILEGES: Record<string, number> = { employee: 0, user: 0, enroller: 2, administrator: 6, admin: 6, 'super administrator': 14, 'super admin': 14 };
export const PRIVILEGE_LABELS = ['Employee', 'Enroller', 'Administrator', 'Super administrator'];

const nameOf = (u: OrgUnit, kind: 'dept' | 'position' | 'area') => String(u[`${kind}_name`] ?? '');
const codeOf = (u: OrgUnit, kind: 'dept' | 'position' | 'area') => String(u[`${kind}_code`] ?? '');

export async function loadExcel() {
  const mod = await import('exceljs');
  return (mod.default ?? mod) as unknown as typeof import('exceljs');
}

export function saveBlob(data: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- template

export async function buildTemplate(lists: { departments: OrgUnit[]; positions: OrgUnit[]; areas: OrgUnit[] }) {
  const ExcelJS = await loadExcel();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'Attendance';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell, i) => {
    const col = COLUMNS[i - 1]!;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? 'FF317726' : 'FF3D9430' } };
    cell.alignment = { vertical: 'middle' };
    cell.note = col.note;
  });

  // Lists sheet (hidden) feeds the drop-downs
  const ls = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const listCol = (col: number, title: string, values: string[]) => {
    ls.getCell(1, col).value = title;
    values.forEach((v, i) => (ls.getCell(i + 2, col).value = v));
    const letter = ls.getColumn(col).letter;
    return values.length ? `Lists!$${letter}$2:$${letter}$${values.length + 1}` : null;
  };
  const deptRange = listCol(1, 'Departments', lists.departments.map((d) => nameOf(d, 'dept')).filter(Boolean));
  const posRange = listCol(2, 'Positions', lists.positions.map((p) => nameOf(p, 'position')).filter(Boolean));
  const areaRange = listCol(3, 'Areas', lists.areas.map((a) => nameOf(a, 'area')).filter(Boolean));
  const privRange = listCol(4, 'Device roles', PRIVILEGE_LABELS);

  const ROWS = 1000;
  const colIndex = (key: string) => COLUMNS.findIndex((c) => c.key === key) + 1;
  const validate = (key: string, rule: object) => {
    const idx = colIndex(key);
    for (let r = 2; r <= ROWS + 1; r++) ws.getCell(r, idx).dataValidation = rule as never;
  };
  const listRule = (formula: string | null, title: string) =>
    formula
      ? { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'warning', errorTitle: title, error: 'Pick a value from the list.' }
      : null;
  for (const [key, range, title] of [
    ['department', deptRange, 'Department'],
    ['position', posRange, 'Position'],
    ['area', areaRange, 'Area'],
    ['privilege', privRange, 'Device role'],
  ] as const) {
    const rule = listRule(range, title);
    if (rule) validate(key, rule);
  }
  validate('gender', { type: 'list', allowBlank: true, formulae: ['"M,F"'], showErrorMessage: true, error: 'M or F' });
  validate('enable_att', { type: 'list', allowBlank: true, formulae: ['"Yes,No"'], showErrorMessage: true, error: 'Yes or No' });
  validate('hire_date', { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(1900, 0, 1)], showErrorMessage: true, error: 'Enter a date, e.g. 2026-01-15' });
  // Codes, cards, PINs and phones are text (keeps leading zeros)
  for (const key of ['emp_code', 'card_no', 'device_password', 'mobile']) ws.getColumn(colIndex(key)).numFmt = '@';
  ws.getColumn(colIndex('hire_date')).numFmt = 'yyyy-mm-dd';

  // Instructions
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 22 }, { width: 100 }];
  help.addRow(['How to fill in this template']).font = { bold: true, size: 14 };
  help.addRow([]);
  [
    ['1.', 'Fill in one employee per row on the "Employees" sheet. Columns with * are required.'],
    ['2.', 'Use the drop-down lists for Department, Position, Area, Device role, Gender and Attendance.'],
    ['3.', 'An employee code that already exists updates that employee; a new code adds a new employee.'],
    ['4.', 'Save the file, then upload it on the Employees page (Import from Excel). You will see a preview before anything is saved.'],
    ['5.', 'New employees are sent to your devices automatically. Enroll their fingerprint or face on the device afterwards.'],
  ].forEach((r) => help.addRow(r));
  help.addRow([]);
  help.addRow(['Column', 'What to enter']).font = { bold: true };
  COLUMNS.forEach((c) => help.addRow([c.required ? `${c.header} *` : c.header, c.note]));
  help.addRow([]);
  help.addRow(['Example', '1001 · Abebe · Kebede · Finance · Accountant · Head office · 0012345678 · 1234 · Employee · 2026-01-15 · M · 0911000000 · abebe@example.com · Yes']);

  return wb.xlsx.writeBuffer();
}

// ---------------------------------------------------------------- reading the file

export type RowStatus = 'new' | 'update' | 'error' | 'skip';
export interface ParsedRow {
  line: number;
  values: Record<string, string>;
  body: Record<string, unknown>;
  status: RowStatus;
  errors: string[];
  existingId?: number;
  result?: { ok: boolean; message?: string };
}

/** Header text → column key (accepts the template headers, with or without *, and the API names). */
function headerKey(text: string): string | null {
  const t = text.replace(/\*/g, '').trim().toLowerCase();
  for (const c of COLUMNS) if (t === c.header.toLowerCase() || t === c.key) return c.key;
  const aliases: Record<string, string> = { code: 'emp_code', 'employee id': 'emp_code', id: 'emp_code', name: 'first_name', phone: 'mobile', card: 'card_no', password: 'device_password', pin: 'device_password', role: 'privilege', privilege: 'privilege', dept: 'department' };
  return aliases[t] ?? null;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return cellText(o.result);
    return '';
  }
  return String(v).trim();
}

function findUnit(list: OrgUnit[], kind: 'dept' | 'position' | 'area', value: string) {
  const v = value.trim().toLowerCase();
  return list.find((u) => nameOf(u, kind).toLowerCase() === v) ?? list.find((u) => codeOf(u, kind).toLowerCase() === v);
}

export async function parseWorkbook(
  data: ArrayBuffer,
  ctx: { departments: OrgUnit[]; positions: OrgUnit[]; areas: OrgUnit[]; existing: Map<string, number>; departmentRequired: boolean },
): Promise<ParsedRow[]> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.getWorksheet('Employees') ?? wb.worksheets.find((w) => w.state === 'visible');
  if (!ws) throw new Error('The file has no sheet to read.');

  // Map columns by their header text
  const cols = new Map<number, string>();
  ws.getRow(1).eachCell((cell, i) => {
    const k = headerKey(cellText(cell.value));
    if (k) cols.set(i, k);
  });
  if (![...cols.values()].includes('emp_code')) throw new Error('No "Employee code" column found. Use the template, or keep its header row.');

  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  ws.eachRow({ includeEmpty: false }, (row, line) => {
    if (line === 1) return;
    const values: Record<string, string> = {};
    cols.forEach((key, i) => (values[key] = cellText(row.getCell(i).value)));
    if (!Object.values(values).some(Boolean)) return; // blank row

    const errors: string[] = [];
    const body: Record<string, unknown> = {};
    const code = values.emp_code ?? '';
    if (!code) errors.push('Employee code is required');
    else if (!/^[A-Za-z0-9]+$/.test(code)) errors.push('Employee code: letters and numbers only');
    else if (code.length > 20) errors.push('Employee code: at most 20 characters');
    else if (seen.has(code.toLowerCase())) errors.push(`Same employee code as row ${seen.get(code.toLowerCase())}`);
    if (code) seen.set(code.toLowerCase(), line);
    body.emp_code = code;

    if (!values.first_name) errors.push('First name is required');
    for (const k of ['first_name', 'last_name'] as const) {
      if ((values[k] ?? '').length > 25) errors.push(`${k === 'first_name' ? 'First' : 'Last'} name: at most 25 characters`);
      if (values[k] !== undefined) body[k] = values[k];
    }

    const unit = (key: 'department' | 'position' | 'area', kind: 'dept' | 'position' | 'area', list: OrgUnit[], label: string) => {
      const v = values[key];
      if (!v) return null;
      const u = findUnit(list, kind, v);
      if (!u) errors.push(`${label} "${v}" doesn't exist (add it on the ${label}s page first)`);
      return u ?? null;
    };
    const dept = unit('department', 'dept', ctx.departments, 'Department');
    if (dept) body.department = dept.id;
    else if (!values.department && ctx.departmentRequired) errors.push('Department is required (BioTime needs it)');
    const pos = unit('position', 'position', ctx.positions, 'Position');
    if (pos) body.position = pos.id;
    const area = unit('area', 'area', ctx.areas, 'Area');
    if (area) body.area = [area.id];

    if (values.card_no) {
      if (values.card_no.length > 20) errors.push('Card number: at most 20 characters');
      body.card_no = values.card_no;
    }
    if (values.device_password) {
      if (!/^\d{1,8}$/.test(values.device_password)) errors.push('Device password: up to 8 digits');
      body.device_password = values.device_password;
    }
    if (values.privilege) {
      const p = PRIVILEGES[values.privilege.toLowerCase()] ?? (/^\d+$/.test(values.privilege) ? Number(values.privilege) : undefined);
      if (p === undefined) errors.push(`Device role "${values.privilege}" is not known (Employee, Enroller, Administrator, Super administrator)`);
      else body.dev_privilege = p;
    }
    if (values.hire_date) {
      const d = values.hire_date.replace(/\//g, '-');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) errors.push(`Hire date "${values.hire_date}" is not a date (use 2026-01-15)`);
      else body.hire_date = d;
    }
    if (values.gender) {
      const g = values.gender.trim().toUpperCase()[0];
      if (g !== 'M' && g !== 'F') errors.push('Gender: M or F');
      else body.gender = g;
    }
    if (values.mobile) body.mobile = values.mobile.slice(0, 20);
    if (values.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.push(`Email "${values.email}" is not valid`);
      else body.email = values.email;
    }
    if (values.enable_att) {
      const v = values.enable_att.toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(v)) body.enable_att = true;
      else if (['no', 'n', 'false', '0'].includes(v)) body.enable_att = false;
      else errors.push('Attendance: Yes or No');
    }

    const existingId = code ? ctx.existing.get(code.toLowerCase()) : undefined;
    rows.push({ line, values, body, errors, existingId, status: errors.length ? 'error' : existingId ? 'update' : 'new' });
  });
  return rows;
}

