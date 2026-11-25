/**
 * Time convention for the database
 * --------------------------------
 * BioTime reports punch times as local wall-clock strings ("2026-11-25 08:30:00") with no time zone.
 * Prisma always writes a JS Date to PostgreSQL as UTC. To keep the database holding exactly the wall-clock
 * value (so "08:30" stays "08:30", and SQL like DATE()/HOUR() works on it), every DATETIME goes
 * through these helpers: the wall-clock value is stored in the Date's UTC fields.
 *
 * Never pass `new Date()` to Prisma directly; use `dbNow()`.
 */
import { localDateTime } from '../utils/http.js';

/** "YYYY-MM-DD HH:mm:ss" (or "YYYY-MM-DD") wall-clock → Date for Prisma. */
export function toDb(value: string): Date;
export function toDb(value: string | null | undefined): Date | null;
export function toDb(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim().replace(' ', 'T');
  const d = new Date(`${s.length === 10 ? `${s}T00:00:00` : s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date from Prisma → "YYYY-MM-DD HH:mm:ss" wall-clock. */
export function fromDb(value: Date): string;
export function fromDb(value: Date | null | undefined): string | null;
export function fromDb(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 19).replace('T', ' ') : null;
}

/** The current local wall-clock time, ready for Prisma. */
export function dbNow(): Date {
  return toDb(localDateTime());
}

/** A JS Date (real instant) → Date for Prisma holding its local wall-clock time. */
export function toDbFromInstant(d: Date): Date {
  return toDb(localDateTime(d));
}
