'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetch from the backend; refetches when `key` changes. Pass null to skip. */
export function useApi<T>(path: string | null, query?: Record<string, string | number | boolean | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const requestId = useRef(0);

  /** `silent`: keep showing the current data while fetching (live updates), no spinner, keep it on error. */
  const fetchData = useCallback(async (silent: boolean) => {
    if (!path) return;
    const id = ++requestId.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await api<T>(path, { query });
      if (id === requestId.current) {
        setData(result);
        if (silent) setError(null);
      }
    } catch (err) {
      if (id === requestId.current && !silent) setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (id === requestId.current && !silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const load = useCallback(() => fetchData(false), [fetchData]);
  const refresh = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, refresh, setData };
}

/** Value that only updates after the user stops typing. */
export function useDebounced<T>(value: T, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
