export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  status: number;
  fields?: FieldErrors;
  constructor(status: number, message: string, fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export interface Paginated<T> {
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  data: T[];
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const res = await fetch(withQuery(`/api${path}`, options.query), {
    method: options.method || 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(401, 'Session expired');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const body = (data && typeof data === 'object' ? data : {}) as { error?: string; fields?: FieldErrors };
    const message =
      body.error ||
      (res.status >= 500 ? 'The API server is not reachable. Is the backend running?' : `Request failed (${res.status})`);
    throw new ApiError(res.status, message, body.fields);
  }
  return data as T;
}

/** Trigger a browser download for a backend CSV endpoint (cookie auth goes along automatically). */
export async function download(path: string, query: Query, fallbackName: string) {
  const res = await fetch(withQuery(`/api${path}`, query), { credentials: 'same-origin' });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
