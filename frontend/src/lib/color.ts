/**
 * Theme colours from one brand colour.
 *
 * Works in OKLCH (perceptual lightness), so every brand gets the same steps: light tints for highlights,
 * the brand itself for buttons (darkened until white text on it reaches 4.5:1), darker steps for hover/text.
 * Dark mode gets its own steps (dark tints, light text), not a flipped copy.
 */

type Lab = { L: number; a: number; b: number };
type Lch = { L: number; C: number; H: number };

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
export function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToOklab([r, g, b]: [number, number, number]): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
function oklabToLinear({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Lch {
  const { L, a, b } = rgbToOklab(hexToRgb(hex));
  return { L, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180) / Math.PI };
}

/** OKLCH → hex, lowering chroma until the colour fits in sRGB (keeps lightness and hue). */
export function oklchToHex({ L, C, H }: Lch): string {
  const rad = (H * Math.PI) / 180;
  const fits = (c: number) => oklabToLinear({ L, a: c * Math.cos(rad), b: c * Math.sin(rad) }).every((v) => v >= -0.0005 && v <= 1.0005);
  let lo = 0;
  let hi = C;
  if (!fits(C)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  } else lo = C;
  const lin = oklabToLinear({ L, a: lo * Math.cos(rad), b: lo * Math.sin(rad) });
  return rgbToHex(lin.map((v) => toGamma(Math.min(1, Math.max(0, v)))) as [number, number, number]);
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

export const DEFAULT_BRAND = '#3d9430';
export const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

export type SidebarMode = 'light' | 'brand' | 'custom';
export interface Appearance {
  brand_color: string;
  sidebar_mode: SidebarMode;
  sidebar_color: string;
}

export interface ThemeTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
  /** The button colour actually used (the brand, darkened if white text would be hard to read) */
  button: string;
  adjusted: boolean;
}

/** All CSS variables for a brand colour and sidebar choice. */
export function themeTokens(a: Appearance): ThemeTokens {
  const brand = isHex(a.brand_color) ? a.brand_color : DEFAULT_BRAND;
  const base = hexToOklch(brand);
  const { H } = base;
  const C = Math.max(base.C, 0.02); // near-greys still get a faint tint

  // Button colour: darken until white text reaches 4.5:1
  let L600 = base.L;
  let button = brand;
  while (contrast('#ffffff', button) < 4.5 && L600 > 0.2) {
    L600 -= 0.01;
    button = oklchToHex({ L: L600, C: base.C, H });
  }
  const at = (L: number, k: number) => oklchToHex({ L, C: C * k, H });
  const L500 = Math.min(0.72, L600 + 0.07);

  const light: Record<string, string> = {
    '--color-brand-50': at(0.975, 0.15),
    '--color-brand-100': at(0.948, 0.3),
    '--color-brand-200': at(0.9, 0.5),
    '--color-brand-300': at(0.83, 0.7),
    '--color-brand-400': at(Math.max(L500 + 0.06, 0.76), 0.85),
    '--color-brand-500': at(L500, 1),
    '--color-brand-600': button,
    '--color-brand-700': at(Math.max(0.18, L600 - 0.07), 1),
    '--color-brand-800': at(Math.max(0.15, L600 - 0.13), 0.9),
    '--color-brand-900': at(Math.max(0.12, L600 - 0.19), 0.8),
    '--primary': button,
    '--primary-foreground': '#ffffff',
    '--ring': at(L500, 1),
    '--sidebar-primary': button,
    '--sidebar-primary-foreground': '#ffffff',
    '--sidebar-ring': at(L500, 1),
  };
  const dark: Record<string, string> = {
    '--color-brand-50': at(0.22, 0.25),
    '--color-brand-100': at(0.27, 0.35),
    '--color-brand-200': at(0.33, 0.45),
    '--color-brand-300': at(0.42, 0.6),
    '--color-brand-500': at(Math.max(L500, 0.6), 1),
    '--color-brand-600': button,
    '--color-brand-700': at(0.82, 0.7),
    '--color-brand-800': at(0.88, 0.5),
    '--color-brand-900': at(0.93, 0.3),
    '--primary': button,
    '--primary-foreground': '#ffffff',
    '--ring': at(Math.max(L500, 0.62), 1),
    '--sidebar-primary': button,
    '--sidebar-ring': at(Math.max(L500, 0.62), 1),
  };

  // Sidebar
  if (a.sidebar_mode === 'light') {
    Object.assign(light, { '--sidebar-accent': at(0.965, 0.25), '--sidebar-accent-foreground': at(Math.max(0.18, L600 - 0.07), 1) });
    Object.assign(dark, { '--sidebar-accent': at(0.26, 0.35), '--sidebar-accent-foreground': at(0.85, 0.6) });
  } else {
    const deep = (mode: 'light' | 'dark') => {
      const bg = a.sidebar_mode === 'custom' && isHex(a.sidebar_color) ? a.sidebar_color : at(mode === 'light' ? 0.27 : 0.2, 0.55);
      const bgL = hexToOklch(bg);
      const darkBg = contrast('#ffffff', bg) >= contrast('#111827', bg);
      const step = (d: number, k = 0.6) => oklchToHex({ L: Math.min(0.98, Math.max(0.05, bgL.L + (darkBg ? d : -d))), C: bgL.C * k, H: bgL.H });
      return {
        '--sidebar': bg,
        '--sidebar-foreground': darkBg ? '#e7e9ee' : '#1f2937',
        '--sidebar-accent': step(0.08),
        '--sidebar-accent-foreground': darkBg ? '#ffffff' : '#111827',
        '--sidebar-border': step(0.06, 0.4),
        '--sidebar-primary': darkBg ? at(0.8, 0.8) : button,
        '--sidebar-primary-foreground': darkBg ? '#111827' : '#ffffff',
        '--sidebar-ring': step(0.25),
      };
    };
    Object.assign(light, deep('light'));
    Object.assign(dark, deep('dark'));
  }

  return { light, dark, button, adjusted: button.toLowerCase() !== brand.toLowerCase() };
}

/** CSS for <style>: wins over globals.css (higher specificity), follows the dark class. */
export function themeCss(a: Appearance) {
  const t = themeTokens(a);
  const block = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `html:root {\n${block(t.light)}\n}\nhtml.dark {\n${block(t.dark)}\n}\n`;
}

/** Nothing to override: the built-in green with a light sidebar. */
export const isDefaultAppearance = (a: Appearance) => !isHex(a.brand_color) && a.sidebar_mode === 'light';
