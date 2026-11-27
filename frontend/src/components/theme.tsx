'use client';

/** Light / dark / follow-the-computer theme (class on <html>, remembered on this computer). */
import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemes, useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

export const THEMES = [
  { value: 'light', icon: Sun, key: 'theme.light' },
  { value: 'dark', icon: Moon, key: 'theme.dark' },
  { value: 'system', icon: Monitor, key: 'theme.system' },
] as const;

/** One-click switch between light and dark (shows the icon of the current look). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  const label = `${t('theme.label')}: ${dark ? t('theme.dark') : t('theme.light')}`;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={`inline-flex size-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ${className}`}
      title={label}
      aria-label={label}
    >
      {dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
    </button>
  );
}
