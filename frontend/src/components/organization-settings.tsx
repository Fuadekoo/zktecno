'use client';

/**
 * Settings > Organization: company information (name, logo, contacts, tax/licence) and the theme colour
 * everyone's dashboard is drawn in. Both apply to everyone the moment they are saved (live update).
 */
import { Building2, Check, ImagePlus, Palette, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { useBranding } from './branding';
import { Alert, Field, Spinner, useToast } from './ui';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { DEFAULT_BRAND, isHex, themeTokens, type Appearance, type SidebarMode } from '@/lib/color';
import type { AppSettings, CompanySettings } from '@/lib/types';

type SaveResponse = { settings: AppSettings };

export function OrganizationSettings({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  return (
    <div className="space-y-6">
      <CompanyInfo settings={settings} onSaved={onSaved} />
      <ThemeColour settings={settings} onSaved={onSaved} />
    </div>
  );
}

// ---------------------------------------------------------------- company info

const FIELDS: { key: keyof CompanySettings; label: string; placeholder?: string; hint?: string; type?: string; lang?: string; max: number }[] = [
  { key: 'name', label: 'Organization name', placeholder: 'e.g. Bikolos Nur Academy', hint: 'Shown in the sidebar, on the sign-in page and in the browser tab.', max: 120 },
  { key: 'name_am', label: 'Name in Amharic', placeholder: 'ለምሳሌ ቢኮሎስ ኑር አካዳሚ', hint: 'Used when the language is አማርኛ.', lang: 'am', max: 120 },
  { key: 'name_om', label: 'Name in Afaan Oromo', placeholder: 'Fkn. Akkaadamii Bikolos Nur', hint: 'Used when the language is Afaan Oromoo.', lang: 'om', max: 120 },
  { key: 'slogan', label: 'Slogan', placeholder: 'e.g. We teach how to learn', hint: 'Printed under the name on reports. Leave blank for none.', max: 160 },
  { key: 'email', label: 'Email', placeholder: 'info@example.com', type: 'email', max: 120 },
  { key: 'website', label: 'Website', placeholder: 'https://example.com', type: 'url', max: 200 },
  { key: 'phone', label: 'Phone', placeholder: '0111 000 000', type: 'tel', max: 30 },
  { key: 'phone2', label: 'Phone 2', placeholder: '0911 000 000', type: 'tel', max: 30 },
  { key: 'tin', label: 'TIN', placeholder: '0001234567', max: 30 },
  { key: 'license_no', label: 'License No.', max: 60 },
  { key: 'code', label: 'Code', placeholder: 'e.g. BIK001', hint: 'Your internal or branch code.', max: 30 },
  { key: 'city', label: 'City / Town', placeholder: 'e.g. Addis Ababa', max: 80 },
  { key: 'subcity', label: 'Sub-city / Woreda', placeholder: 'e.g. Bole', max: 80 },
  { key: 'address', label: 'Address / House No.', placeholder: 'Street, building, house number', max: 200 },
];

const MAX_LOGO_BYTES = 500 * 1024;

/** Read an image file as a data URL, shrinking large photos to 512 px (keeps transparency). */
async function readLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP or SVG image.');
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the image'));
      r.readAsDataURL(blob);
    });
  if (file.type === 'image/svg+xml') {
    if (file.size > MAX_LOGO_BYTES) throw new Error('The SVG is larger than 500 KB.');
    return asDataUrl(file);
  }
  const url = await asDataUrl(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not open the image'));
    img.src = url;
  });
  const scale = Math.min(1, 512 / Math.max(img.width, img.height));
  if (scale === 1 && file.size <= MAX_LOGO_BYTES) return url;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
  if (out.length > 680_000) throw new Error('The logo is still too large after shrinking. Try a simpler image.');
  return out;
}

function CompanyInfo({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const toast = useToast();
  const { setBranding } = useBranding();
  const [form, setForm] = useState<CompanySettings>(settings.company);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [logoError, setLogoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setForm(settings.company), [settings.company]);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.company);
  const set = (k: keyof CompanySettings, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    try {
      set('logo', await readLogo(file));
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Could not use this image');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await api<SaveResponse>('/settings/company', { method: 'PUT', body: form });
      onSaved(r.settings);
      const c = r.settings.company;
      setBranding({ company: { name: c.name, name_am: c.name_am, name_om: c.name_om, slogan: c.slogan, logo: c.logo }, appearance: r.settings.appearance });
      toast('Company information saved');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" />
            Company info
          </CardTitle>
          <CardDescription>Your organization’s details. The name and logo appear for everyone, including on the sign-in page.</CardDescription>
          <CardAction>
            <button className="btn-primary" disabled={busy || !dirty}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : <Save className="size-4" />}
              Save
            </button>
          </CardAction>
        </CardHeader>
        <CardContent className="mt-4 space-y-5">
          {error && <Alert>{error}</Alert>}

          <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.key === 'name' || f.key === 'slogan' || f.key === 'address' ? 'sm:col-span-2' : ''}>
                  <Field label={f.label} error={fields[f.key]} hint={f.hint}>
                    <input
                      className="input"
                      type={f.type ?? 'text'}
                      lang={f.lang}
                      value={form[f.key]}
                      placeholder={f.placeholder}
                      maxLength={f.max}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => set(f.key, e.target.value)}
                    />
                  </Field>
                </div>
              ))}
            </div>

            {/* Logo */}
            <div>
              <div className="flex items-center justify-between">
                <span className="label mb-0">Logo</span>
                {form.logo && (
                  <button type="button" className="btn-ghost text-xs text-red-600" onClick={() => set('logo', '')}>
                    <Trash2 className="size-3.5" />
                    Remove
                  </button>
                )}
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setDragging(false);
                  void pickLogo(e.dataTransfer.files?.[0]);
                }}
                className={`mt-1 flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
                  dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                {form.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <>
                    <ImagePlus className="size-8 text-slate-400" />
                    <p className="mt-2 text-sm font-medium text-slate-700">Drop your logo here, or click</p>
                    <p className="mt-1 text-xs text-slate-500">PNG, JPEG, WebP or SVG. A square image with a transparent background looks best.</p>
                  </>
                )}
              </div>
              {logoError && <p className="mt-2 text-xs text-red-600">{logoError}</p>}
              {fields.logo && <p className="mt-2 text-xs text-red-600">{fields.logo}</p>}
              <p className="mt-2 text-xs text-slate-500">Used in the sidebar, the sign-in page and as the browser-tab icon. Large images are shrunk automatically.</p>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void pickLogo(e.target.files?.[0])} />
            </div>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- theme colour

const PRESETS: { name: string; color: string }[] = [
  { name: 'Green (default)', color: DEFAULT_BRAND },
  { name: 'Orange', color: '#f59e0b' },
  { name: 'Blue', color: '#2563eb' },
  { name: 'Teal', color: '#0d9488' },
  { name: 'Emerald', color: '#16a34a' },
  { name: 'Red', color: '#dc2626' },
  { name: 'Purple', color: '#7c3aed' },
  { name: 'Rose', color: '#e11d48' },
  { name: 'Navy', color: '#1b2a4a' },
];

const SIDEBAR_MODES: { value: SidebarMode; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'A white sidebar with the brand colour on the selected page.' },
  { value: 'brand', label: 'Brand shade', hint: 'A deep shade of the brand colour, chosen so the labels always stay readable.' },
  { value: 'custom', label: 'Custom', hint: 'Pick any colour. The label colour (light or dark) is chosen automatically for readability.' },
];

function ThemeColour({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const toast = useToast();
  const { branding, setBranding } = useBranding();
  const saved = settings.appearance;
  const [value, setValue] = useState<Appearance>(saved);
  const [hexText, setHexText] = useState(saved.brand_color);
  const [sidebarText, setSidebarText] = useState(saved.sidebar_color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(saved);
    setHexText(saved.brand_color);
    setSidebarText(saved.sidebar_color);
  }, [saved]);

  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const brand = isHex(value.brand_color) ? value.brand_color : DEFAULT_BRAND;
  const tokens = useMemo(() => themeTokens(value), [value]);

  function setBrand(c: string) {
    setHexText(c);
    if (c === '' || isHex(c)) setValue((v) => ({ ...v, brand_color: c.toLowerCase() }));
  }
  function setSidebar(c: string) {
    setSidebarText(c);
    if (c === '' || isHex(c)) setValue((v) => ({ ...v, sidebar_color: c.toLowerCase() }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...value, sidebar_color: value.sidebar_mode === 'custom' ? value.sidebar_color : '' };
      if (body.sidebar_mode === 'custom' && !isHex(body.sidebar_color)) throw new Error('Pick a sidebar colour, or choose another sidebar style.');
      const r = await api<SaveResponse>('/settings/appearance', { method: 'PUT', body });
      onSaved(r.settings);
      setBranding({ company: branding.company, appearance: r.settings.appearance });
      toast('Theme colour saved. Everyone sees it now.');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setValue({ brand_color: '', sidebar_mode: 'light', sidebar_color: '' });
    setHexText('');
    setSidebarText('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" />
          Theme colour
        </CardTitle>
        <CardDescription>The colour everyone’s dashboard is drawn in: buttons, highlights, the selected menu item and the sidebar are all derived from it.</CardDescription>
        <CardAction className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={reset} disabled={busy} title="Back to the built-in green and a light sidebar">
            <RotateCcw className="size-4" />
            Reset to default
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !dirty}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : <Save className="size-4" />}
            Save
          </button>
        </CardAction>
      </CardHeader>
      <CardContent className="mt-4">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <div>
              <span className="label">Presets</span>
              <div className="flex flex-wrap gap-2.5">
                {PRESETS.map((p) => {
                  const selected = brand.toLowerCase() === p.color.toLowerCase();
                  return (
                    <button
                      key={p.color}
                      type="button"
                      title={p.name}
                      aria-label={p.name}
                      aria-pressed={selected}
                      onClick={() => setBrand(p.color === DEFAULT_BRAND ? '' : p.color)}
                      className={`flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-white transition hover:scale-105 ${selected ? 'ring-2 ring-slate-900' : ''}`}
                      style={{ background: p.color }}
                    >
                      {selected && <Check className="size-4 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="label">Brand colour</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                  aria-label="Pick a brand colour"
                />
                <input
                  className={`input font-mono ${hexText && !isHex(hexText) ? 'border-red-400' : ''}`}
                  value={hexText}
                  placeholder={DEFAULT_BRAND}
                  onChange={(e) => setBrand(e.target.value.trim())}
                  maxLength={7}
                  aria-label="Brand colour (hex)"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {hexText && !isHex(hexText)
                  ? 'Use a 6-digit colour like #1b2a4a.'
                  : tokens.adjusted
                    ? `This colour is light, so buttons use a deeper shade (${tokens.button}) to keep white text readable.`
                    : 'Leave empty to use the built-in green.'}
              </p>
            </div>

            <div>
              <span className="label">Sidebar</span>
              <div className="grid grid-cols-3 gap-2">
                {SIDEBAR_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setValue((v) => ({ ...v, sidebar_mode: m.value }))}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      value.sidebar_mode === m.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{SIDEBAR_MODES.find((m) => m.value === value.sidebar_mode)!.hint}</p>
              {value.sidebar_mode === 'custom' && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="color"
                    value={isHex(value.sidebar_color) ? value.sidebar_color : '#1e293b'}
                    onChange={(e) => setSidebar(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                    aria-label="Pick a sidebar colour"
                  />
                  <input
                    className={`input font-mono ${sidebarText && !isHex(sidebarText) ? 'border-red-400' : ''}`}
                    value={sidebarText}
                    placeholder="#1e293b"
                    onChange={(e) => setSidebar(e.target.value.trim())}
                    maxLength={7}
                    aria-label="Sidebar colour (hex)"
                  />
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Saved colours apply the moment you press Save: on this screen and on every open dashboard. Charts keep their own colour-blind-safe colours.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Preview title="Light mode" vars={tokens.light} dark={false} sidebarMode={value.sidebar_mode} />
            <Preview title="Dark mode" vars={tokens.dark} dark sidebarMode={value.sidebar_mode} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** A small mock-up of the dashboard in the chosen colours. */
function Preview({ title, vars, dark, sidebarMode }: { title: string; vars: Record<string, string>; dark: boolean; sidebarMode: SidebarMode }) {
  const surface = dark ? '#191919' : '#ffffff';
  const page = dark ? '#0f0f10' : '#f8fafc';
  const text = dark ? '#f4f4f5' : '#0f172a';
  const muted = dark ? '#2e2e33' : '#e2e8f0';
  const sidebarBg = sidebarMode === 'light' ? (dark ? '#141416' : '#ffffff') : vars['--sidebar']!;
  const sidebarFg = sidebarMode === 'light' ? (dark ? '#d4d4d8' : '#334155') : vars['--sidebar-foreground']!;
  const accent = vars['--sidebar-accent'] ?? muted;
  const accentFg = vars['--sidebar-accent-foreground'] ?? text;
  const button = vars['--color-brand-600']!;
  const tint = vars['--color-brand-50']!;
  const tintText = vars['--color-brand-700']!;

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">{title}</div>
      <div className="flex h-44 overflow-hidden rounded-xl border border-slate-200 shadow-sm" style={{ background: page }} aria-hidden="true">
        <div className="flex w-[34%] flex-col gap-1.5 p-2" style={{ background: sidebarBg, borderRight: sidebarMode === 'light' ? `1px solid ${muted}` : 'none' }}>
          <div className="mb-1 flex items-center gap-1.5">
            <div className="size-4 rounded" style={{ background: button }} />
            <div className="h-1.5 flex-1 rounded-full opacity-70" style={{ background: sidebarFg }} />
          </div>
          <div className="flex h-5 items-center rounded px-1.5" style={{ background: accent }}>
            <div className="h-1.5 w-3/4 rounded-full" style={{ background: accentFg }} />
          </div>
          {[70, 55, 62].map((w) => (
            <div key={w} className="flex h-5 items-center px-1.5">
              <div className="h-1.5 rounded-full opacity-50" style={{ width: `${w}%`, background: sidebarFg }} />
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2.5">
          <div className="text-[11px] font-semibold" style={{ color: text }}>
            Dashboard
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: button }}>
              Save
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: tint, color: tintText }}>
              Badge
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2 rounded-lg p-2" style={{ background: surface, border: `1px solid ${muted}` }}>
            {[82, 64, 45].map((w) => (
              <div key={w} className="h-1.5 overflow-hidden rounded-full" style={{ background: muted }}>
                <div className="h-full rounded-full" style={{ width: `${w}%`, background: button }} />
              </div>
            ))}
            <div className="mt-1 text-[10px] font-medium" style={{ color: tintText }}>
              View all →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
