import {
  DEFAULT_PDF_THEME,
  type PdfTheme,
  resolvePdfTheme,
} from '../pdf-theme.js';

/**
 * Deterministic kit validators (port of v1 `validate_resume_html.mjs` and
 * `validate_resume_content.mjs`). No LLM, no filesystem: the PDF theme is
 * passed in (or resolved from defaults), so the settings read happens once.
 */

export interface Violation {
  code: string;
  detail: string;
  optional?: boolean;
}

export interface ValidationResult {
  violations: Violation[];
  hardViolations: Violation[];
  ok: boolean;
}

/* ------------------------------- layout -------------------------------- */

const CLASS_GROUPS: string[][] = [
  ['resume-container', 'page'],
  ['candidate-name', 'name'],
  ['target-title', 'headline'],
  ['contact-info', 'contact'],
  ['section-title'],
  ['summary-text', 'summary'],
  ['skills'],
  ['job-entry', 'job'],
  ['job-company', 'company'],
  ['job-meta', 'dates', 'meta'],
];

const OPTIONAL_GROUPS: string[][] = [
  ['location-line'],
  ['edu-entry', 'two-col'],
  ['edu-degree'],
  ['edu-school', 'edu-meta'],
  ['languages'],
  ['job-title', 'role', '@h3'],
  ['bullet-list', 'clean', '@ul'],
];

function hasClass(html: string, names: string[]): boolean {
  return names.some((name) => {
    if (name === '@h3') return /<h3[\s>]/i.test(html);
    if (name === '@ul') return /<ul[\s>]/i.test(html);
    return new RegExp(`class=["'][^"']*\\b${name}\\b`, 'i').test(html);
  });
}

export interface ValidateHtmlOptions {
  stack?: string;
  accentColor?: string | null;
  theme?: PdfTheme;
}

export interface ValidateHtmlResult extends ValidationResult {
  stack: string;
  expectedAccent: string;
  summary: { bytes: number; accentCount: number; colors: string[] };
}

export function validateResumeHtml(
  html: string,
  options: ValidateHtmlOptions = {},
): ValidateHtmlResult {
  const stack = String(options.stack || 'ruby').toLowerCase() === 'php'
    ? 'php'
    : 'ruby';
  const theme = options.theme ?? DEFAULT_PDF_THEME;
  const expected = (
    options.accentColor || theme[stack]?.accent || resolvePdfTheme(null)[stack].accent
  ).toUpperCase();
  const violations: Violation[] = [];

  for (const group of CLASS_GROUPS) {
    if (!hasClass(html, group)) {
      violations.push({
        code: 'missing-class',
        detail: `Classe obrigatória ausente: ${group.join(' | ')}`,
      });
    }
  }

  for (const group of OPTIONAL_GROUPS) {
    if (!hasClass(html, group)) {
      violations.push({
        code: 'missing-optional',
        detail: `Classe opcional ausente: ${group.join(' | ')}`,
        optional: true,
      });
    }
  }

  const accents = html.match(/class=["'][^"']*\baccent\b[^"']*["']/gi) ?? [];
  if (accents.length === 0) {
    violations.push({
      code: 'accent-missing',
      detail: 'Faixa .accent ausente (exigida: 1 por documento)',
    });
  } else if (accents.length > 1) {
    violations.push({
      code: 'accent-multiple',
      detail: `Faixa .accent duplicada (${accents.length}, exigida: 1)`,
    });
  }

  const colors = [...html.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) =>
    match[0].toUpperCase(),
  );
  if (accents.length > 0 && !colors.includes(expected)) {
    violations.push({
      code: 'accent-color-mismatch',
      detail: `Cor da faixa ≠ cor do stack ${stack} (${expected}). Encontradas: ${
        [...new Set(colors)].slice(0, 8).join(' ') || 'nenhuma hex'
      }`,
    });
  }

  if (
    /column-count\s*:\s*[2-9]|columns\s*:\s*[^;]*2|float\s*:\s*(left|right)\s*;[^}]*width\s*:\s*4\d%/i.test(
      html,
    )
  ) {
    violations.push({
      code: 'multi-column',
      detail: 'Layout multicoluna detectado (exigido: coluna única)',
    });
  }

  const external: string[] = [];
  if (/<link[^>]+>/i.test(html)) external.push('<link>');
  if (/<img[^>]+>/i.test(html)) external.push('<img>');
  if (/@import/i.test(html)) external.push('@import');
  if (/url\(\s*https?:/i.test(html)) external.push('url(http)');
  if (/fonts\.googleapis/i.test(html)) external.push('fonts.googleapis');
  if (external.length > 0) {
    violations.push({
      code: 'external-asset',
      detail: `Assets externos proibidos (ATS): ${external.join(', ')}`,
    });
  }

  const skillsBlock = html.match(
    /class=["'][^"']*\bskills\b[^"']*["'][^>]*>([\s\S]*?)(<\/div>|<\/p>)/i,
  );
  if (!skillsBlock) {
    violations.push({ code: 'missing-class', detail: 'Bloco .skills ausente' });
  } else if (/class=["'][^"']*\bskill\b/i.test(skillsBlock[1] || skillsBlock[0])) {
    violations.push({
      code: 'highlights-pills',
      detail:
        'Highlights em pills .skill (modelo antigo) — exigido: parágrafo .skills com grupos <strong>Categoria:</strong>',
    });
  } else if (!/<strong>/i.test(skillsBlock[0])) {
    violations.push({
      code: 'highlights-uncategorized',
      detail:
        'Highlights sem categorias <strong> (exigido: <strong>Backend:</strong> ... | ...)',
      optional: true,
    });
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > 120 * 1024) {
    violations.push({
      code: 'html-too-large',
      detail: `HTML com ${bytes} bytes (> 120KB)`,
    });
  }

  const hard = violations.filter((violation) => !violation.optional);
  return {
    stack,
    expectedAccent: expected,
    violations,
    hardViolations: hard,
    ok: hard.length === 0,
    summary: {
      bytes,
      accentCount: accents.length,
      colors: [...new Set(colors)].slice(0, 12),
    },
  };
}

/* ------------------------------- content ------------------------------- */

export const BANNED_PHRASES = [
  'proven track record',
  'proven ability',
  'passionate',
  'results-driven',
  'seasoned professional',
  'rockstar',
  'ninja',
  'synergy',
  'self-starter',
  'team player',
  'out of the box',
  'thought leader',
];

export function stripTags(html: unknown): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

/** Ammo numbers that should appear in the kit (19xx-21xx years excluded). */
export function extractAmmoNumbers(ammoSection: unknown): string[] {
  const found = new Set<string>();
  for (const match of String(ammoSection ?? '').matchAll(
    /\d[\d.,]*\s?[%+x×]?/g,
  )) {
    const raw = match[0].trim();
    const digits = raw.replace(/[^\d]/g, '');
    const num = parseInt(digits, 10);
    if (!raw || Number.isNaN(num)) continue;
    if (/^(19|20)\d{2}$/.test(digits)) continue;
    if (digits.length > 4) continue;
    found.add(raw.replace(/\s+/g, ''));
    if (found.size >= 20) break;
  }
  return [...found];
}

/** Accepts a plain label or a `CoverageTerm` (whose `src` pattern is used). */
export interface TermLikeObject {
  term: string;
  src?: string;
  baseHits?: number;
  jobSnippet?: string;
  baseSnippet?: string;
}

type TermLike = string | TermLikeObject;

function termOf(item: TermLike): string {
  return typeof item === 'string' ? item : item.term;
}

function includesTerm(stripped: string, item: TermLike): boolean {
  const source =
    typeof item === 'object' && item && typeof item.src === 'string'
      ? item.src
      : null;
  if (source) {
    try {
      return new RegExp(source, 'i').test(stripped);
    } catch {
      // fall back to the literal label
    }
  }
  const label = String(termOf(item) || '').trim();
  if (!label) return false;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(`\\b${escaped}\\b`, 'i').test(stripped);
  } catch {
    return stripped.toLowerCase().includes(label.toLowerCase());
  }
}

export interface ValidateContentOptions {
  mustCover?: TermLike[];
  forbidden?: TermLike[];
  coreKept?: TermLike[];
  bannedPhrases?: string[];
  ammoNumbers?: string[];
}

/** Content validation: coverage, grounding, clichés and ammo usage. */
export function validateResumeContent(
  html: string,
  options: ValidateContentOptions = {},
): ValidationResult {
  const {
    mustCover = [],
    forbidden = [],
    coreKept = [],
    bannedPhrases = BANNED_PHRASES,
    ammoNumbers = [],
  } = options;
  const violations: Violation[] = [];
  const stripped = stripTags(html);

  for (const item of mustCover) {
    if (!includesTerm(stripped, item)) {
      const term = termOf(item);
      const jobSnippet =
        typeof item === 'object' ? item.jobSnippet ?? '' : '';
      const baseSnippet =
        typeof item === 'object' ? item.baseSnippet ?? '' : '';
      violations.push({
        code: 'missing-coverage',
        detail: `Match genuíno ausente no kit: "${term}" (vaga: ${jobSnippet.slice(
          0,
          100,
        )} | use o caso de uso do base: ${baseSnippet.slice(0, 120)})`,
      });
    }
  }

  for (const item of forbidden) {
    if (includesTerm(stripped, item)) {
      violations.push({
        code: 'hallucinated-term',
        detail: `Termo alucinado no kit: "${termOf(item)}" (vaga cita, base NÃO tem — remover)`,
      });
    }
  }

  for (const phrase of bannedPhrases) {
    if (stripped.toLowerCase().includes(String(phrase).toLowerCase())) {
      violations.push({
        code: 'banned-phrase',
        detail: `Clichê proibido no kit: "${phrase}" (substituir por fato concreto)`,
      });
    }
  }

  if (ammoNumbers.length > 0) {
    const flat = stripped.replace(/\s+/g, '').toLowerCase();
    const hit = ammoNumbers.filter((number) =>
      flat.includes(String(number).toLowerCase()),
    );
    if (hit.length === 0) {
      violations.push({
        code: 'ammo-ignored',
        detail: `Nenhum número da munição aparece no kit (${ammoNumbers.length} disponíveis, ex: ${ammoNumbers
          .slice(0, 3)
          .join(', ')})`,
      });
    } else if (hit.length < Math.ceil(ammoNumbers.length / 2)) {
      violations.push({
        code: 'ammo-underused',
        optional: true,
        detail: `Munição subaproveitada: ${hit.length}/${ammoNumbers.length} números usados`,
      });
    }
  }

  for (const item of coreKept) {
    if (!includesTerm(stripped, item)) {
      const baseHits = typeof item === 'object' ? item.baseHits ?? '?' : '?';
      violations.push({
        code: 'core-dropped',
        optional: true,
        detail: `Núcleo do candidato ausente: "${termOf(
          item,
        )}" (${baseHits} menções no base; manter nos Highlights salvo contradição)`,
      });
    }
  }

  const hard = violations.filter((violation) => !violation.optional);
  return { violations, hardViolations: hard, ok: hard.length === 0 };
}
