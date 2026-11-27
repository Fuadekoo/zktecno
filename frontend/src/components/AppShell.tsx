'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { Icon, type IconName } from './icons';
import { LiveBadge, RealtimeProvider } from './realtime';
import { Alert, Field, Modal, Spinner, ToastProvider, useToast } from './ui';
import { UserContext, type CurrentUser } from './user-context';

const NAV: { href: string; label: string; icon: IconName; adminOnly?: boolean }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/transactions', label: 'Punch Logs', icon: 'clock' },
  { href: '/reports', label: 'Attendance Report', icon: 'report' },
  { href: '/employees', label: 'Employees', icon: 'users' },
  { href: '/departments', label: 'Departments', icon: 'building' },
  { href: '/positions', label: 'Positions', icon: 'badge' },
  { href: '/areas', label: 'Areas', icon: 'map' },
  { href: '/devices', label: 'Devices', icon: 'device' },
  { href: '/nearby', label: 'Nearby Devices', icon: 'radar', adminOnly: true },
  { href: '/system', label: 'Sync & Activity', icon: 'refresh' },
  { href: '/webhooks', label: 'Webhooks', icon: 'send', adminOnly: true },
  { href: '/users', label: 'Users', icon: 'shield', adminOnly: true },
  { href: '/settings', label: 'Settings', icon: 'settings', adminOnly: true },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    api<{ user: CurrentUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
    // Only check once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const nav = NAV.filter((n) => !n.adminOnly || user.role === 'admin');

  return (
    <UserContext.Provider value={user}>
      <ToastProvider>
        <RealtimeProvider>
        <div className="min-h-screen lg:pl-64">
          <aside
            className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">ZK</div>
              <div>
                <p className="text-sm font-semibold leading-tight text-slate-900">Attendance</p>
                <LiveBadge />
              </div>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive(item.href) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon name={item.icon} className="h-[18px] w-[18px]" />
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="border-t border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                <button className="min-w-0 text-left" onClick={() => setPasswordOpen(true)} title="Change password">
                  <p className="truncate text-sm font-medium text-slate-700">{user.full_name || user.username}</p>
                  <p className="text-xs capitalize text-slate-500">{user.role}</p>
                </button>
                <button className="btn-ghost" onClick={logout} title="Sign out" aria-label="Sign out">
                  <Icon name="logout" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
          {menuOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setMenuOpen(false)} />}

          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
            <button className="btn-ghost" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <span className="font-semibold">Attendance</span>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
        <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
        </RealtimeProvider>
      </ToastProvider>
    </UserContext.Provider>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
      setFields({});
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setFields({ confirm: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      toast('Password changed');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Change password"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" form="pw-form" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />}
            Save
          </button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Current password" error={fields.current_password}>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" error={fields.new_password} hint="At least 8 characters">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Confirm new password" error={fields.confirm}>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
}
