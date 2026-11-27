'use client';

import {
  Activity,
  BadgeCheck,
  Building2,
  ChevronsUpDown,
  Clock,
  Cpu,
  FileBarChart,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPin,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { LiveBadge, RealtimeProvider } from './realtime';
import { Alert, Field, Modal, Spinner, ToastProvider, useToast } from './ui';
import { UserContext, type CurrentUser } from './user-context';

type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Attendance',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/transactions', label: 'Punch Logs', icon: Clock },
      { href: '/reports', label: 'Attendance Report', icon: FileBarChart },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/employees', label: 'Employees', icon: Users },
      { href: '/departments', label: 'Departments', icon: Building2 },
      { href: '/positions', label: 'Positions', icon: BadgeCheck },
      { href: '/areas', label: 'Areas', icon: MapPin },
    ],
  },
  {
    label: 'Devices',
    items: [
      { href: '/devices', label: 'Devices', icon: Cpu },
      { href: '/nearby', label: 'Nearby Devices', icon: Radar, adminOnly: true },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/system', label: 'Sync & Activity', icon: Activity },
      { href: '/webhooks', label: 'Webhooks', icon: Send, adminOnly: true },
      { href: '/users', label: 'Users', icon: ShieldCheck, adminOnly: true },
      { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

const SIDEBAR_KEY = 'sidebar-open';

const isActivePath = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Open/closed is remembered on this computer
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    api<{ user: CurrentUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
    setSidebarOpen(localStorage.getItem(SIDEBAR_KEY) !== 'false');
    // Only check once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeSidebar(open: boolean) {
    setSidebarOpen(open);
    localStorage.setItem(SIDEBAR_KEY, String(open));
  }

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

  const current = NAV_GROUPS.flatMap((g) => g.items).find((i) => isActivePath(pathname, i.href));

  return (
    <UserContext.Provider value={user}>
      <ToastProvider>
        <RealtimeProvider>
          <TooltipProvider delayDuration={0}>
            <SidebarProvider open={sidebarOpen} onOpenChange={changeSidebar}>
              <AppSidebar user={user} pathname={pathname} onChangePassword={() => setPasswordOpen(true)} onLogout={logout} />
              <SidebarInset className="min-w-0 bg-slate-50">
                <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
                  <SidebarTrigger className="-ml-1" title="Show / hide the menu (Ctrl+B)" />
                  <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
                  <span className="truncate text-sm font-medium text-slate-700">{current?.label ?? 'Attendance'}</span>
                  <div className="ml-auto">
                    <LiveBadge />
                  </div>
                </header>
                <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
          <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
        </RealtimeProvider>
      </ToastProvider>
    </UserContext.Provider>
  );
}

function AppSidebar({ user, pathname, onChangePassword, onLogout }: { user: CurrentUser; pathname: string; onChangePassword: () => void; onLogout: () => void }) {
  const { setOpenMobile, isMobile } = useSidebar();
  // On phones the menu is a drawer: close it after choosing a page
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  const name = user.full_name || user.username;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Dashboard">
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">ZK</div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold text-slate-900">Attendance</span>
                  <span className="truncate text-xs text-slate-500">ZKTeco devices</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || user.role === 'admin');
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActivePath(pathname, item.href)} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" tooltip={name}>
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-brand-100 text-xs font-semibold text-brand-700">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <span className="truncate text-xs capitalize text-slate-500">{user.role}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4} className="min-w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{name}</div>
                  <div className="text-xs capitalize text-slate-500">{user.role}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onChangePassword}>
                  <KeyRound />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onLogout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
