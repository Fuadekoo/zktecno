'use client';

/**
 * Organization branding for every page (also the login page): company name, logo and theme colours.
 * The last branding is kept on this computer so pages open in the right colours straight away, then the
 * current one is fetched from /api/branding. Settings changes arrive live (see AppShell).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { isDefaultAppearance, themeCss, type Appearance } from '@/lib/color';
import { useI18n } from '@/lib/i18n';

export interface Branding {
  company: { name: string; name_am: string; name_om: string; slogan: string; logo: string };
  appearance: Appearance;
}

const EMPTY: Branding = {
  company: { name: '', name_am: '', name_om: '', slogan: '', logo: '' },
  appearance: { brand_color: '', sidebar_mode: 'light', sidebar_color: '' },
};
const CACHE_KEY = 'branding';
const STYLE_ID = 'brand-theme';

/** Put the theme colours on the page (or remove them for the default look). */
export function applyAppearance(a: Appearance) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (isDefaultAppearance(a)) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = themeCss(a);
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-brand]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.dataset.brand = '1';
    document.head.appendChild(link);
  }
  link.href = href;
}

type Ctx = { branding: Branding; setBranding: (b: Branding) => void; displayName: string };
const BrandingContext = createContext<Ctx>({ branding: EMPTY, setBranding: () => {}, displayName: '' });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const [branding, setState] = useState<Branding>(EMPTY);

  const setBranding = useCallback((b: Branding) => {
    const merged = { company: { ...EMPTY.company, ...b.company }, appearance: { ...EMPTY.appearance, ...b.appearance } };
    setState(merged);
    applyAppearance(merged.appearance);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
    } catch {
      /* storage full (large logo): fine, it is fetched again next time */
    }
  }, []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setBranding(JSON.parse(cached));
    } catch {
      /* ignore */
    }
    fetch('/api/branding', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBranding(b))
      .catch(() => {});
  }, [setBranding]);

  // The name in the chosen language, falling back to the main name
  const c = branding.company;
  const displayName = (lang === 'am' && c.name_am) || (lang === 'om' && c.name_om) || c.name;

  useEffect(() => {
    document.title = displayName ? `${displayName} · Attendance` : 'Attendance | BioTime';
    setFavicon(c.logo);
  }, [displayName, c.logo]);

  return <BrandingContext.Provider value={{ branding, setBranding, displayName }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

/** Logo, or the initials of the company name on the brand colour. */
export function BrandMark({ className = 'size-8 text-sm' }: { className?: string }) {
  const { branding, displayName } = useBranding();
  if (branding.company.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={branding.company.logo} alt="" className={`${className} shrink-0 rounded-lg bg-white object-contain`} />;
  }
  const initials = (displayName || 'ZK')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <div className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-brand-600 font-bold text-white`}>{initials}</div>;
}
