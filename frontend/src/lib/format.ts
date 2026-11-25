export function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function minutesToHours(minutes: number) {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function fullName(e: { first_name?: string | null; last_name?: string | null }) {
  return [e.first_name, e.last_name].filter(Boolean).join(' ');
}

/** BioTime device state: 1 = online. Everything else is shown as offline. */
export function deviceOnline(state: number | string | null | undefined): boolean {
  return Number(state) === 1;
}

/** "2026-11-25 08:30:00" → "08:30" (today) or "25 Nov 08:30". */
export function shortDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const [date, time = ''] = value.split(' ');
  if (date === todayISO()) return time.slice(0, 5);
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${time.slice(0, 5)}`;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** "2026-11-25 08:30:00" → "5 min ago" / "2 h ago" / date. */
export function timeAgo(value: string | null | undefined) {
  if (!value) return 'never';
  const t = new Date(value.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return value;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDateTime(value);
}

export function intervalLabel(seconds: number) {
  if (seconds % 3600 === 0) return seconds === 3600 ? 'every hour' : `every ${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? 'every minute' : `every ${seconds / 60} minutes`;
  return `every ${seconds}s`;
}
