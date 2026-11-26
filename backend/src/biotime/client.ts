import { config } from '../config.js';
import type { FieldErrors } from '../utils/http.js';
import type { BtPage } from './types.js';

/**
 * Error raised for any problem talking to BioTime.
 * `status` is the HTTP status BioTime returned (or 503 when it could not be reached).
 */
export class BioTimeError extends Error {
  fieldErrors?: FieldErrors;
  constructor(
    message: string,
    public status = 502,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'BioTimeError';
  }
}

const META_KEYS = new Set(['code', 'msg', 'detail', 'count', 'next', 'previous', 'data', 'results']);

/** Turn the different BioTime / Django REST Framework error shapes into one readable message. */
function extractMessage(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  if (typeof d.msg === 'string' && d.msg) return d.msg;
  if (typeof d.detail === 'string') return d.detail;
  if (Array.isArray(d.non_field_errors)) return d.non_field_errors.join(' ');
  const parts: string[] = [];
  for (const [field, value] of Object.entries(d)) {
    if (META_KEYS.has(field)) continue;
    const text = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
    if (text) parts.push(`${field}: ${text}`);
  }
  return parts.join('; ');
}

/** Field-level errors (DRF style: { field: ["message"] }) so the UI can show them next to inputs. */
function extractFieldErrors(data: unknown): FieldErrors | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const fields: FieldErrors = {};
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    if (META_KEYS.has(field)) continue;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) fields[field] = value.join(' ');
    else if (typeof value === 'string') fields[field] = value;
  }
  return Object.keys(fields).length ? fields : undefined;
}

function looksLikeAuthProblem(err: BioTimeError) {
  if (err.status === 401) return true;
  if (err.status !== 403) return false;
  return /token|credential|expired|signature|authenticat/i.test(err.message);
}

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  auth?: boolean;
}

export interface BioTimeOptions {
  baseUrl: string;
  username: string;
  password: string;
  authType: 'jwt' | 'token';
  timeoutMs: number;
}

export class BioTimeClient {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly opts: BioTimeOptions) {}

  get baseUrl() {
    return this.opts.baseUrl;
  }

  private get authHeader() {
    return `${this.opts.authType === 'jwt' ? 'JWT' : 'Token'} ${this.token}`;
  }

  private buildUrl(path: string, query?: Query) {
    const url = new URL(this.opts.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async rawRequest<T>(method: string, path: string, { query, body, auth = true }: RequestOptions = {}): Promise<T> {
    if (!config.biotime.enabled) throw new BioTimeError('BioTime is turned off (BIOTIME_ENABLED=false in backend/.env).', 503);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (auth) headers.Authorization = this.authHeader;

    let res: Response;
    try {
      res = await fetch(this.buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (cause) {
      const timedOut = (cause as Error)?.name === 'TimeoutError';
      throw new BioTimeError(
        timedOut
          ? `BioTime server at ${this.opts.baseUrl} did not respond within ${this.opts.timeoutMs / 1000}s`
          : `Cannot reach BioTime server at ${this.opts.baseUrl}. Check BIOTIME_URL and that BioTime is running.`,
        503,
      );
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const err = new BioTimeError(extractMessage(data) || `BioTime responded with HTTP ${res.status}`, res.status, data);
      err.fieldErrors = extractFieldErrors(data);
      throw err;
    }

    // Some BioTime endpoints answer 200 but put the failure in { code: <non-zero>, msg }.
    if (data && typeof data === 'object') {
      const d = data as { code?: unknown; msg?: string };
      if (typeof d.code === 'number' && d.code !== 0) {
        throw new BioTimeError(d.msg || `BioTime returned error code ${d.code}`, 400, data);
      }
    }
    return data as T;
  }

  private async login(): Promise<string> {
    const path = this.opts.authType === 'jwt' ? '/jwt-api-token-auth/' : '/api-token-auth/';
    let data: { token?: string };
    try {
      data = await this.rawRequest('POST', path, {
        auth: false,
        body: { username: this.opts.username, password: this.opts.password },
      });
    } catch (err) {
      if (err instanceof BioTimeError && err.status >= 400 && err.status < 500) {
        throw new BioTimeError(
          `BioTime rejected the login for user "${this.opts.username}". Check BIOTIME_USERNAME / BIOTIME_PASSWORD. (${err.message})`,
          502,
        );
      }
      throw err;
    }
    if (!data?.token) throw new BioTimeError('BioTime login succeeded but returned no token', 502, data);
    this.token = data.token;
    return data.token;
  }

  /** Get a token, sharing one in-flight login between concurrent requests. */
  private async ensureToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    if (force) this.token = null;
    this.tokenPromise ??= this.login().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  /** Authenticated request; logs in again once when the token has expired. */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    await this.ensureToken();
    try {
      return await this.rawRequest<T>(method, path, options);
    } catch (err) {
      if (err instanceof BioTimeError && looksLikeAuthProblem(err)) {
        await this.ensureToken(true);
        return this.rawRequest<T>(method, path, options);
      }
      throw err;
    }
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, { body });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  delete(path: string) {
    return this.request<void>('DELETE', path);
  }

  /** One page of a list endpoint, normalised to { count, hasNext, hasPrevious, data }. */
  async list<T>(path: string, query: Query = {}): Promise<BtPage<T>> {
    const { page_size, ...rest } = query;
    const size = page_size ? Number(page_size) : undefined;
    // BioTime builds differ: some read `page_size`, some `limit`. Sending both is harmless.
    const raw = await this.get<unknown>(path, { ...rest, page_size: size, limit: size });
    const r = (raw ?? {}) as { count?: number; next?: unknown; previous?: unknown; data?: T[]; results?: T[] };
    const data = Array.isArray(raw) ? (raw as T[]) : (r.data ?? r.results ?? []);
    return {
      count: typeof r.count === 'number' ? r.count : data.length,
      hasNext: Boolean(r.next),
      hasPrevious: Boolean(r.previous),
      data,
    };
  }

  /** Walk every page of a list endpoint. */
  async listAll<T>(path: string, query: Query = {}, { pageSize = 500, maxPages = 1000 } = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await this.list<T>(path, { ...query, page, page_size: pageSize });
      items.push(...result.data);
      if (!result.hasNext || result.data.length === 0 || items.length >= result.count) break;
    }
    return items;
  }

  /** Verify the connection and credentials. */
  async ping() {
    const started = Date.now();
    await this.ensureToken(true);
    await this.list('/iclock/api/terminals/', { page: 1, page_size: 1 });
    return { ok: true, latencyMs: Date.now() - started };
  }
}

export const biotime = new BioTimeClient(config.biotime);
