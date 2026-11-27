'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { BrandMark, useBranding } from '@/components/branding';
import { Alert, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { username, password } });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setBusy(false);
    }
  }

  const { branding, displayName } = useBranding();

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
      <div className="mb-2 flex items-center gap-3">
        <BrandMark className="size-10 text-base" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900">{displayName || 'Attendance'}</h1>
          <p className="truncate text-sm text-slate-500">{branding.company.slogan || 'Sign in to continue'}</p>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <label className="block">
        <span className="label">Username</span>
        <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="btn-primary w-full" disabled={busy}>
        {busy && <Spinner className="h-4 w-4 text-white" />}
        Sign in
      </button>
      <p className="text-center text-xs leading-relaxed text-slate-400">
        This is the dashboard login, not your BioTime login. The first admin is created from ADMIN_USERNAME / ADMIN_PASSWORD in
        backend/.env. Forgot it? Run <code className="rounded bg-slate-100 px-1">npm run user:reset-password -- admin NewPass123</code> in the
        backend folder.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <Suspense fallback={<Spinner className="h-8 w-8" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
