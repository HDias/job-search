import type { Store } from '../../repositories/types.js';

/**
 * Deterministic file-name helpers for generated kits (port of the v1
 * `job_processor.mjs` helpers). No I/O beyond the settings read.
 */

export const CANDIDATE_SLUG_FALLBACK = 'Horecio-Dias';

/** Normalizes company/role for a safe folder name (lowercase, underscores). */
export function sanitizeName(value: unknown): string {
  return String(value ?? 'item')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Candidate slug used in the PDF download name (`Horecio-Dias-<Role>.pdf`).
 * Reads `settings.candidate_form` (D10); falls back to the legacy constant.
 */
export function getCandidateFileSlug(store: Pick<Store, 'settings'>): string {
  const form = store.settings.get<{ fullName?: unknown }>('candidate_form');
  const full = String(form?.fullName ?? '').trim();
  if (!full) return CANDIDATE_SLUG_FALLBACK;

  const parts = full.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const slug = [first, last]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-zÀ-ú-]+/g, '')
    .replace(/^-+|-+$/g, '');

  return slug || CANDIDATE_SLUG_FALLBACK;
}

const ROLE_STOPWORDS =
  /^(de|da|do|e|a|o|em|para|sr|jr|senior|sênior|pleno|junior|on|for|with|and|the|an|of|in|to)$/i;

/** Short role for the file name: up to 5 words, Title-Case, hyphenated. */
export function shortRoleFileSlug(role: unknown): string {
  const words = String(role ?? 'Resume')
    .replace(/[()/\\|,;:]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !ROLE_STOPWORDS.test(word))
    .slice(0, 5);

  const slug = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug || 'Resume';
}
