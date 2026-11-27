'use client';

import { Check, KeyRound, Palette, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type FormEvent } from 'react';
import { initialsOf } from '@/components/AppShell';
import { THEMES } from '@/components/theme';
import { Alert, Field, Spinner, useToast } from '@/components/ui';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSetUser, useUser, type CurrentUser } from '@/components/user-context';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { LANGUAGES, useI18n } from '@/lib/i18n';

type Tab = 'profile' | 'appearance' | 'security';
const TABS: Tab[] = ['profile', 'appearance', 'security'];

export default function ProfilePage() {
  const { t } = useI18n();
  const { user } = useUser();
  const [tab, setTab] = useState<Tab>('profile');

  // The URL hash picks the tab (/profile#security from the profile menu) and follows tab changes
  useEffect(() => {
    const pick = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.includes(h)) setTab(h);
    };
    pick();
    window.addEventListener('hashchange', pick);
    return () => window.removeEventListener('hashchange', pick);
  }, []);
  function change(v: string) {
    setTab(v as Tab);
    history.replaceState(null, '', v === 'profile' ? '/profile' : `/profile#${v}`);
  }

  if (!user) return null;
  const name = user.full_name || user.username;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-4">
        <Avatar className="size-16">
          <AvatarFallback className="bg-brand-600 text-xl font-semibold text-white">{initialsOf(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-slate-900">{name}</h1>
          <p className="text-sm text-slate-500">
            @{user.username} · {t(user.role === 'admin' ? 'role.admin' : 'role.viewer')}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={change}>
        <TabsList className="mb-4">
          <TabsTrigger value="profile">
            <UserRound className="size-4" />
            {t('profile.tab.profile')}
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="size-4" />
            {t('profile.tab.appearance')}
          </TabsTrigger>
          <TabsTrigger value="security">
            <KeyRound className="size-4" />
            {t('profile.tab.security')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileForm user={user} />
        </TabsContent>
        <TabsContent value="appearance">
          <Appearance />
        </TabsContent>
        <TabsContent value="security">
          <PasswordForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const setUser = useSetUser();
  const [fullName, setFullName] = useState(user.full_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await api<{ user: CurrentUser }>('/auth/me', { method: 'PATCH', body: { full_name: fullName } });
      setUser(r.user);
      toast(t('profile.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.tab.profile')}</CardTitle>
        <CardDescription>{t('profile.adminOnly')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label={t('profile.fullName')} error={fields.full_name}>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} autoComplete="name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('profile.username')}>
              <input className="input" value={user.username} disabled />
            </Field>
            <Field label={t('profile.role')}>
              <input className="input" value={t(user.role === 'admin' ? 'role.admin' : 'role.viewer')} disabled />
            </Field>
            <Field label={t('profile.lastLogin')}>
              <input className="input" value={user.last_login_at ? new Date(user.last_login_at.replace(' ', 'T')).toLocaleString(locale) : '—'} disabled />
            </Field>
          </div>
          <button className="btn-primary" disabled={busy || fullName === (user.full_name ?? '')}>
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {t('profile.save')}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

function Appearance() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? 'system') : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('theme.label')}</CardTitle>
          <CardDescription>{t('appearance.themeHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t('theme.label')}>
            {THEMES.map((th) => {
              const selected = current === th.value;
              return (
                <button
                  key={th.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(th.value)}
                  className={`relative overflow-hidden rounded-xl border-2 text-left transition ${selected ? 'border-brand-600' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  {/* Small preview of the look */}
                  <div className={`flex h-20 gap-1.5 p-2 ${th.value === 'dark' ? 'bg-[#0f0f10]' : th.value === 'light' ? 'bg-[#f8fafc]' : 'bg-gradient-to-r from-[#f8fafc] from-50% to-[#0f0f10] to-50%'}`}>
                    <div className={`w-6 rounded ${th.value === 'dark' ? 'bg-[#141416]' : 'bg-white'} shadow-sm`} />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className={`h-3 rounded ${th.value === 'dark' ? 'bg-[#191919]' : 'bg-white'} shadow-sm`} />
                      <div className={`flex-1 rounded ${th.value === 'dark' ? 'bg-[#191919]' : 'bg-white'} shadow-sm`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
                    <th.icon className="size-4" />
                    {t(th.key)}
                    {selected && <Check className="ml-auto size-4 text-brand-700" />}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('lang.label')}</CardTitle>
          <CardDescription>{t('appearance.languageHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t('lang.label')}>
            {LANGUAGES.map((l) => {
              const selected = lang === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  lang={l.code}
                  onClick={() => setLang(l.code)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{l.native}</div>
                    <div className="text-xs text-slate-500">{l.label}</div>
                  </div>
                  {selected && <Check className="size-4 text-brand-700" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setFields({ confirm: t('pw.mismatch') });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      toast(t('pw.changed'));
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pw.title')}</CardTitle>
        <CardDescription>{t('pw.hint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label={t('pw.current')} error={fields.current_password}>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label={t('pw.new')} error={fields.new_password} hint={t('pw.newHint')}>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          </Field>
          <Field label={t('pw.confirm')} error={fields.confirm}>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <button className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {t('pw.save')}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
