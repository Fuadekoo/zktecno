'use client';

import {
  Activity,
  BadgeCheck,
  Building2,
  Check,
  Clock,
  Cpu,
  FileBarChart,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  MapPin,
  Palette,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
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
import { api } from '@/lib/api';
import { LANGUAGES, useI18n, type TKey } from '@/lib/i18n';
import { BrandMark, useBranding, type Branding } from './branding';
import { LiveBadge, RealtimeProvider, useLive } from './realtime';
import { THEMES, ThemeToggle } from './theme';
import { Spinner, ToastProvider } from './ui';
import { SetUserContext, UserContext, type CurrentUser } from './user-context';

type NavItem = { href: string; key: TKey; icon: LucideIcon; adminOnly?: boolean };

const NAV_GROUPS: { key: TKey; items: NavItem[] }[] = [
  {
    key: 'nav.group.attendance',
    items: [
      { href: '/', key: 'nav.dashboard', icon: LayoutDashboard },
      { href: '/transactions', key: 'nav.transactions', icon: Clock },
      { href: '/reports', key: 'nav.reports', icon: FileBarChart },
    ],
  },
  {
    key: 'nav.group.people',
    items: [
      { href: '/employees', key: 'nav.employees', icon: Users },
      { href: '/departments', key: 'nav.departments', icon: Building2 },
      { href: '/positions', key: 'nav.positions', icon: BadgeCheck },
      { href: '/areas', key: 'nav.areas', icon: MapPin },
    ],
  },
  {
    key: 'nav.group.devices',
    items: [
      { href: '/devices', key: 'nav.devices', icon: Cpu },
      { href: '/nearby', key: 'nav.nearby', icon: Radar, adminOnly: true },
    ],
  },
  {
    key: 'nav.group.system',
    items: [
      { href: '/system', key: 'nav.system', icon: Activity },
      { href: '/webhooks', key: 'nav.webhooks', icon: Send, adminOnly: true },
      { href: '/users', key: 'nav.users', icon: ShieldCheck, adminOnly: true },
      { href: '/settings', key: 'nav.settings', icon: Settings, adminOnly: true },
    ],
  },
];

const SIDEBAR_KEY = 'sidebar-open';

const isActivePath = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [user, setUser] = useState<CurrentUser | null>(null);
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
  const title = pathname.startsWith('/profile') ? t('profile.title') : current ? t(current.key) : t('app.name');

  return (
    <UserContext.Provider value={user}>
      <SetUserContext.Provider value={setUser}>
        <ToastProvider>
          <RealtimeProvider>
            <TooltipProvider delayDuration={0}>
              <SidebarProvider open={sidebarOpen} onOpenChange={changeSidebar}>
                <AppSidebar user={user} pathname={pathname} />
                <SidebarInset className="min-w-0 bg-slate-50">
                  {/* Navbar */}
                  <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-4">
                    <SidebarTrigger className="-ml-1" title={t('nav.toggle')} />
                    <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
                    <span className="truncate text-sm font-medium text-slate-700">{title}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <span className="mr-2 hidden sm:inline-flex">
                        <LiveBadge />
                      </span>
                      <LanguageMenu />
                      <ThemeToggle />
                      <ProfileMenu user={user} onLogout={logout} />
                    </div>
                  </header>
                  <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
                </SidebarInset>
              </SidebarProvider>
            </TooltipProvider>
          </RealtimeProvider>
        </ToastProvider>
      </SetUserContext.Provider>
    </UserContext.Provider>
  );
}

function AppSidebar({ user, pathname }: { user: CurrentUser; pathname: string }) {
  const { setOpenMobile, isMobile } = useSidebar();
  const { t } = useI18n();
  const { displayName, setBranding } = useBranding();
  // An admin changed the name, logo or colours: apply them here right away
  useLive('branding', (b) => setBranding(b as Branding));
  // On phones the menu is a drawer: close it after choosing a page
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={t('nav.dashboard')}>
              <Link href="/">
                <BrandMark className="aspect-square size-8 text-sm" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">{displayName || t('app.name')}</span>
                  <span className="truncate text-xs opacity-70">{displayName ? t('app.name') : t('app.tagline')}</span>
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
            <SidebarGroup key={group.key}>
              <SidebarGroupLabel>{t(group.key)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActivePath(pathname, item.href)} tooltip={t(item.key)}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{t(item.key)}</span>
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
      <SidebarRail />
    </Sidebar>
  );
}

/** Globe button: English / አማርኛ / Afaan Oromoo. */
function LanguageMenu() {
  const { lang, setLang, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title={t('lang.label')}
          aria-label={t('lang.label')}
        >
          <Languages className="size-[18px]" />
          <span className="hidden text-xs font-medium uppercase md:inline">{lang}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t('lang.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => setLang(l.code)} lang={l.code}>
            <span className="flex-1">{l.native}</span>
            {l.code !== 'en' && <span className="text-xs text-slate-500">{l.label}</span>}
            {lang === l.code && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Profile icon in the top-right corner: profile, appearance (theme + language), password, sign out. */
function ProfileMenu({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const name = user.full_name || user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ml-1 rounded-full outline-none ring-brand-500 focus-visible:ring-2" aria-label={t('menu.profile')} title={name}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-brand-600 text-xs font-semibold text-white">{initialsOf(name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <Avatar className="size-9">
            <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-700">{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{name}</div>
            <div className="truncate text-xs text-slate-500">
              @{user.username} · {t(user.role === 'admin' ? 'role.admin' : 'role.viewer')}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/profile')}>
          <UserRound />
          {t('menu.profile')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            {t('menu.appearance')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            <DropdownMenuLabel className="text-xs text-slate-500">{t('theme.label')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
              {THEMES.map((th) => (
                <DropdownMenuRadioItem key={th.value} value={th.value}>
                  <th.icon className="size-4" />
                  {t(th.key)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-slate-500">{t('lang.label')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
              {LANGUAGES.map((l) => (
                <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code}>
                  {l.native}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => router.push('/profile#security')}>
          <KeyRound />
          {t('user.changePassword')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="text-red-600 focus:text-red-700">
          <LogOut />
          {t('user.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
