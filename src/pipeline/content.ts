/**
 * Deterministic text helpers shared by the pipeline (port of the v1 helpers
 * from `job_processor.mjs` and `scrape_job.mjs`). No LLM, no I/O.
 */

export const JOB_CONTENT_LIMIT = 12_000;
export const EXTRA_TEXT_LIMIT = 6_000;
export const PROMPT_JOB_LIMIT = 6_000;
export const PROMPT_EXTRA_LIMIT = 3_000;
export const PROMPT_RESUME_LIMIT = 15_000;
export const THIN_CONTENT_MIN_CHARS = 500;

export function truncate(value: unknown, limit: number): string {
  return String(value ?? '').slice(0, limit);
}

const THIN_CONTENT_SIGNALS = [
  'requisitos',
  'experiência',
  'experiencia',
  'responsabilidades',
  'benefícios',
  'beneficios',
  'qualificações',
  'qualificacoes',
  'atividades',
  'salário',
  'salario',
  'requirements',
  'experience',
  'responsibilities',
  'benefits',
  'qualifications',
  'skills',
  'salary',
  'years of',
  'you will',
  'looking for',
  'about the role',
  'about the job',
  'job description',
  'descrição da vaga',
  'descricao da vaga',
  'what you',
  'nice to have',
  'must have',
  'remote',
  'remoto',
  'hiring',
  'contratando',
];

/**
 * True when the scrape returned a shell (blocked page, cookie banner, nav)
 * instead of the job description — empty, too short, or long with no job
 * signal at all.
 */
export function isJobContentThin(content: unknown): boolean {
  const text = String(content ?? '').trim();
  if (!text) return true;
  if (text.length < THIN_CONTENT_MIN_CHARS) return true;
  const sample = text.slice(0, 4000).toLowerCase();
  if (
    text.length < 1500 &&
    !THIN_CONTENT_SIGNALS.some((signal) => sample.includes(signal))
  ) {
    return true;
  }
  return false;
}

export const THIN_CONTENT_REASON =
  'Não consegui extrair a descrição da vaga pelo link (o site pode bloquear leitura automática). Cole o texto da vaga abaixo e rode o fit de novo — sem o texto, qualquer fit seria 0% e não vale nada.';

const PT_LANGUAGE_KEYWORDS = [
  'requisitos',
  'experiência',
  'experiencia',
  'vaga',
  'benefícios',
  'beneficios',
  'atividades',
  'responsabilidades',
  'conhecimento',
  'salário',
  'salario',
  'currículo',
  'curriculo',
];

const EN_LANGUAGE_KEYWORDS = [
  'requirements',
  'experience',
  'responsibilities',
  'benefits',
  'qualifications',
  'skills',
  'salary',
  'looking for',
  'join the team',
  'years of',
  'what you',
  'you will',
  'hiring',
];

/** Same heuristic as v1 `detectLangFromText` (pasted text, no scrape). */
export function detectLangFromText(text: unknown): 'pt-br' | 'en' {
  const sample = String(text ?? '')
    .slice(0, 4000)
    .toLowerCase();
  const ptScore = PT_LANGUAGE_KEYWORDS.filter((key) =>
    sample.includes(key),
  ).length;
  const enScore = EN_LANGUAGE_KEYWORDS.filter((key) =>
    sample.includes(key),
  ).length;
  if (enScore > ptScore) return 'en';
  if (ptScore > enScore) return 'pt-br';
  // Tie with no signal: accents usually mean Portuguese.
  if (/[ãõçâêô]/i.test(sample)) return 'pt-br';
  if (enScore > 0) return 'en';
  return 'pt-br';
}

/** Scraper heuristic: PT/EN keyword score with confidence counts. */
export function detectLanguageScores(text: unknown): {
  detectedLanguage: 'pt-br' | 'en';
  ptScore: number;
  enScore: number;
} {
  const sample = String(text ?? '').slice(0, 2000).toLowerCase();
  const ptScore = PT_LANGUAGE_KEYWORDS.filter((key) =>
    sample.includes(key),
  ).length;
  const enScore = EN_LANGUAGE_KEYWORDS.filter((key) =>
    sample.includes(key),
  ).length;
  return {
    detectedLanguage: ptScore >= enScore ? 'pt-br' : 'en',
    ptScore,
    enScore,
  };
}

export function normalizeLang(value: unknown): 'pt-br' | 'en' {
  return value === 'en' ? 'en' : 'pt-br';
}

export function normalizeLangKey(value: unknown): 'en' | 'pt_br' {
  return value === 'en' ? 'en' : 'pt_br';
}

export function normalizeStack(value: unknown): string {
  return String(value || 'ruby').toLowerCase() === 'php' ? 'php' : 'ruby';
}

/**
 * Only blocks generation when the posting EXPLICITLY requires a language
 * (e.g. "resume translated to english", "currículo em português").
 * A mere divergence from the LLM language guess must not block (v1 fix).
 */
export function hasExplicitLanguageRequirement(
  content: unknown,
  requiredLang: unknown,
): boolean {
  const text = String(content ?? '').toLowerCase();
  if (!text) return false;
  if (normalizeLang(requiredLang) === 'en') {
    return /resum[ée].*(english|ingl[êe]s)|cv.*english|resume.*translated|english.*resume|curriculum.*english|submit.*english/i.test(
      text,
    );
  }
  return (
    /curr[íi]culo.*portugu[êe]s|portugu[êe]s.*curr[íi]culo|resume.*portuguese|portugu[êe]s\s*\(pt-br\)/i.test(
      text,
    ) && !/english/i.test(text.slice(0, 2000))
  );
}

/**
 * Deterministic logistics note: hybrid/on-site outside Brazil makes
 * eligibility the main filter, above any CV adjustment. Returns null when
 * there is no signal.
 */
export function detectLogisticsNote(
  jobData: { location?: string | null; content?: string | null } | null,
): string | null {
  const location = String(jobData?.location || '');
  const content = String(jobData?.content || '').slice(0, 4000);
  const text = `${location}\n${content}`;
  const onsiteish =
    /hybrid|on[-\s]?site|presencial|h[íi]brido|in[-\s]?office|working from|based in/i.test(
      text,
    );
  if (!onsiteish) return null;
  const outsideBR =
    /united kingdom|\buk\b|glasgow|london|edinburgh|united states|u\.s\.|usa\b|canada|germany|france|spain|portugal|ireland|netherlands|europe|visa|sponsorship|right to work|relocation/i.test(
      text,
    );
  if (!outsideBR) return null;
  const remoteWorldwide =
    /remote\s+(worldwide|global|anywhere)|work from anywhere|remote\s*:\s*brazil/i.test(
      text,
    );
  if (remoteWorldwide) return null;
  const where =
    location.trim().split('\n')[0].slice(0, 80) || 'local não informado';
  return `Vaga híbrida/presencial fora do Brasil (${where}) — elegibilidade/logística é o filtro principal desta candidatura, acima de qualquer ajuste no CV.`;
}
