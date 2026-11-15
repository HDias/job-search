import type { Store } from '../repositories/types.js';
import { profileRawText } from './profiles.js';

/**
 * Candidate contact data derived from the base resume (port of v1's
 * `extractCandidateFromBase`, server.mjs:106–159). The resume text is the
 * source of truth; the saved `candidate_form` fills whatever is missing.
 */

export interface ExtractedCandidate {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN = /(linkedin\.com\/[^\s)]+)/i;
const GITHUB = /(github\.com\/[^\s)]+)/i;

const NAME_BLOCK =
  /principais|competênc|resumo|idiomas?|contato|certifica|experi[eê]ncia|forma[çc]|habilidades?|sobre|perfil|objetivo|curr[ií]culo/i;
const NAME_ROLE =
  /Engenheiro|Software|Backend|Frontend|Senior|Sênior|Desenvolvedor/i;
// v1 used `\s+` between name words, which let a name swallow the next line
// ("Horecio Dias\nEngenheiro") and exceed the length limit. Only spaces and
// tabs separate words here.
const NAME_CANDIDATE = /([A-ZÀ-Ú][a-zà-ú]{2,}(?:[ \t]+[A-ZÀ-Ú][a-zà-ú]{2,}){1,3})/g;

const NAME_WINDOW = 400;
const NAME_FALLBACK_WINDOW = 1200;
const MAX_PHONE_LENGTH = 30;
const MAX_NAME_LENGTH = 45;
const MIN_NAME_LENGTH = 5;

function emptyCandidate(): ExtractedCandidate {
  return {
    fullName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    linkedin: '',
    github: '',
    portfolio: '',
  };
}

function guessName(text: string): string {
  const emailIndex = text.search(EMAIL);
  const window =
    emailIndex >= 0
      ? text.slice(
          Math.max(0, emailIndex - NAME_WINDOW),
          emailIndex + NAME_WINDOW,
        )
      : text.slice(0, NAME_FALLBACK_WINDOW);

  for (const match of window.matchAll(NAME_CANDIDATE)) {
    const candidate = (match[1] ?? '').trim();
    if (candidate.length < MIN_NAME_LENGTH || candidate.length > MAX_NAME_LENGTH) {
      continue;
    }
    if (NAME_BLOCK.test(candidate)) continue;
    if (NAME_ROLE.test(candidate)) continue;
    return candidate;
  }

  return '';
}

/** Fills the first value found for each field, in text order (v1 parity). */
export function extractCandidateFromTexts(
  texts: readonly string[],
): ExtractedCandidate {
  const out = emptyCandidate();

  for (const text of texts) {
    if (!text) continue;

    if (!out.email) {
      const match = text.match(EMAIL);
      if (match) out.email = match[0];
    }
    if (!out.phone) {
      const match = text.match(PHONE);
      if (match?.[1]) out.phone = match[1].trim().slice(0, MAX_PHONE_LENGTH);
    }
    if (!out.linkedin) {
      const match = text.match(LINKEDIN);
      if (match?.[1]) {
        out.linkedin = `https://www.${match[1].replace(/^www\./i, '')}`;
      }
    }
    if (!out.github && GITHUB.test(text)) {
      const match = text.match(GITHUB);
      if (match?.[1]) {
        out.github = `https://${match[1].replace(/^www\./i, '')}`;
      }
    }
    if (!out.fullName) {
      out.fullName = guessName(text);
    }
  }

  if (out.fullName) {
    const parts = out.fullName.split(' ');
    out.firstName = parts[0] ?? '';
    out.lastName = parts.slice(1).join(' ');
  }

  return out;
}

/** v1 file order: ruby PT-BR, ruby EN, then PHP PT-BR/EN. */
const PROFILE_ORDER: ReadonlyArray<[string, string]> = [
  ['ruby', 'pt-br'],
  ['ruby', 'en'],
  ['php', 'pt-br'],
  ['php', 'en'],
];

/**
 * Derived fields win; the saved `candidate_form` only fills the blanks (an
 * empty saved string must not erase what the resume provides) and keeps any
 * extra keys such as `updatedAt`.
 */
export function candidateFromStore(store: Store): Record<string, unknown> {
  const texts = PROFILE_ORDER.map(([stack, language]) =>
    profileRawText(store.profiles.get(stack, language)),
  );

  const merged: Record<string, unknown> = { ...extractCandidateFromTexts(texts) };
  const saved = store.settings.get<Record<string, unknown>>('candidate_form');

  for (const [key, value] of Object.entries(saved ?? {})) {
    if (key in merged && merged[key]) continue;
    merged[key] = value;
  }

  return merged;
}
