'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { SyncResult } from '@/lib/types';
import { Icon } from './icons';
import { Spinner, useToast } from './ui';
import { useUser } from './user-context';

/** Pulls fresh data from BioTime into PostgreSQL right now (admins only). */
export function SyncButton({ onDone, label = 'Sync now' }: { onDone?: () => void; label?: string }) {
  const { isAdmin } = useUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  async function run() {
    setBusy(true);
    try {
      const r = await api<SyncResult>('/system/sync', { method: 'POST', body: { job: 'all' } });
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast(`Sync problem: ${failed.map((f) => `${f.job}: ${f.error}`).join('; ')}`, 'error');
      else toast(`Synced: ${r.results.map((x) => `${x.count} ${x.job}`).join(', ')}`);
      onDone?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn-primary" onClick={run} disabled={busy}>
      {busy ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="database" className="h-4 w-4" />}
      {busy ? 'Syncing…' : label}
    </button>
  );
}
