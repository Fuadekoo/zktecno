import type { Response } from 'express';

export type FieldErrors = Record<string, string>;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}

type QueryValue = unknown;

/** Read a single string from req.query (ignores arrays/objects). */
export function str(value: QueryValue): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  return undefined;
}

/** Copy only the listed keys from an object, dropping undefined values. */
export function pick<T extends Record<string, unknown>>(source: T | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/** Query params that are plain strings, for forwarding to BioTime. */
export function pickQuery(query: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = str(query[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Record ids are non-zero integers. Negative ids are employees read from devices (see employeesRepo.upsertFromDevice). */
export function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id === 0) throw new HttpError(400, `Invalid id "${String(value)}"`);
  return id;
}

export function pagination(query: Record<string, unknown>, defaultSize = 20) {
  const page = Math.max(1, Number.parseInt(str(query.page) ?? '', 10) || 1);
  const pageSize = Math.min(500, Math.max(1, Number.parseInt(str(query.page_size) ?? '', 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

export function isDate(value: unknown): boolean {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Accept "YYYY-MM-DD" or "YYYY-MM-DD HH:mm[:ss]" and return "YYYY-MM-DD HH:mm:ss". */
export function toDateTime(value: string | undefined, endOfDay = false): string | undefined {
  if (!value) return undefined;
  if (isDate(value)) return `${value} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  if (DATETIME_RE.test(value)) {
    const normalised = value.replace('T', ' ');
    return normalised.length === 16 ? `${normalised}:00` : normalised;
  }
  throw new HttpError(400, `Invalid date/time "${value}". Use YYYY-MM-DD or YYYY-MM-DD HH:mm:ss`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date-time as YYYY-MM-DD HH:mm:ss (the format BioTime and our DATETIME columns use). */
export function localDateTime(d = new Date()) {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parse "YYYY-MM-DD HH:mm:ss" as local time. */
export function parseLocalDateTime(value: string) {
  return new Date(value.replace(' ', 'T'));
}

export function eachDate(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (d <= last) {
    days.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export interface CsvColumn<T> {
  label: string;
  value: keyof T | ((row: T) => unknown);
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','),
  );
  // BOM so Excel opens UTF-8 (Arabic/Urdu names etc.) correctly.
  return '﻿' + [header, ...lines].join('\r\n');
}

export function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(csv);
}
