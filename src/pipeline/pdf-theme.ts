import type { Store } from '../repositories/types.js';

/**
 * Single PDF-theme reader (D10). v1 duplicated `getPdfTheme` in three places
 * (processor, validator, server); here the theme lives in
 * `settings['pdf_theme']` with in-code defaults.
 */

export interface PdfThemeStack {
  accent: string;
  accentDark: string;
  label: string;
}

export interface PdfTheme {
  ruby: PdfThemeStack;
  php: PdfThemeStack;
  cssVersion: string;
}

export const DEFAULT_PDF_THEME: PdfTheme = {
  ruby: { accent: '#B56A6A', accentDark: '#9E4A4A', label: 'Ruby' },
  php: { accent: '#4F5B93', accentDark: '#3F4A7A', label: 'PHP' },
  cssVersion: 'b1',
};

function mergeStack(
  base: PdfThemeStack,
  patch: unknown,
): PdfThemeStack {
  if (!patch || typeof patch !== 'object') return { ...base };
  const raw = patch as Partial<PdfThemeStack>;
  return {
    accent: typeof raw.accent === 'string' ? raw.accent : base.accent,
    accentDark:
      typeof raw.accentDark === 'string' ? raw.accentDark : base.accentDark,
    label: typeof raw.label === 'string' ? raw.label : base.label,
  };
}

/** Merges a stored theme over the defaults (never throws on partial data). */
export function resolvePdfTheme(raw: unknown): PdfTheme {
  if (!raw || typeof raw !== 'object') {
    return {
      ruby: { ...DEFAULT_PDF_THEME.ruby },
      php: { ...DEFAULT_PDF_THEME.php },
      cssVersion: DEFAULT_PDF_THEME.cssVersion,
    };
  }
  const value = raw as {
    ruby?: unknown;
    php?: unknown;
    cssVersion?: unknown;
  };
  return {
    ruby: mergeStack(DEFAULT_PDF_THEME.ruby, value.ruby),
    php: mergeStack(DEFAULT_PDF_THEME.php, value.php),
    cssVersion:
      typeof value.cssVersion === 'string' && value.cssVersion
        ? value.cssVersion
        : DEFAULT_PDF_THEME.cssVersion,
  };
}

export function getPdfTheme(store: Pick<Store, 'settings'>): PdfTheme {
  return resolvePdfTheme(store.settings.get('pdf_theme'));
}

/** Uppercased accent of a stack, falling back to Ruby (v1 behavior). */
export function accentFor(theme: PdfTheme, stack: string): string {
  const normalized = String(stack || 'ruby').toLowerCase() === 'php' ? 'php' : 'ruby';
  return (theme[normalized]?.accent || theme.ruby.accent).toUpperCase();
}
