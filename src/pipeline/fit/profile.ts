/**
 * Deterministic base-resume analyzer (port of `scripts/analyze_profile.mjs`).
 * No LLM, no file cache: pure functions so the pipeline can run from the DB.
 */

const MONTH_IDX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const MONTH_ALT =
  'january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const PRESENT_ALT = 'present|presente|atual|hoje|current|now';

const DATE_RE = new RegExp(
  `(${MONTH_ALT})\\s*(?:de\\s+)?(\\d{4})\\s*[\\-\\u2013\\u2014]\\s*((${MONTH_ALT})\\s*(?:de\\s+)?(\\d{4})|${PRESENT_ALT})`,
  'gi',
);

const STACKS: [string, RegExp][] = [
  ['Rails', /\bruby on rails\b|\brails\b/i],
  ['Ruby', /\bruby\b/i],
  ['PHP', /\bphp\b/i],
  ['Laravel', /\blaravel\b/i],
  ['Zend', /\bzend\b/i],
  ['Symfony', /\bsymfony\b/i],
  ['Vue', /\bvue(\.js|js)?\b/i],
  ['Ember', /\bember(\.js|js)?\b/i],
  ['Stimulus', /\bstimulus/i],
  ['React', /\breact(\s?native)?\b/i],
  ['Angular', /\bangular/i],
  ['JS/TS', /\bjavascript\b|\btypescript\b|\bjquery\b/i],
  ['PostgreSQL', /\bpostgres/i],
  ['MySQL', /\bmysql\b/i],
  ['Sidekiq', /\bsidekiq\b/i],
  ['AWS', /\baws\b|\bec2\b|\brds\b|\bs3\b|\blambda/i],
  ['Docker', /\bdocker\b/i],
];

const SIGNALS: [string, RegExp][] = [
  ['multi-municipio', /78\s*munic[ií]pios?|dezenas de munic[ií]pios?|78\s*municipalities?/i],
  ['migracao-banco', /migra[cç][aã]o|\bmysql\s*[→\->]\s*postgres|migration/i],
  ['performance', /\bn\+1\b|eager loading|pagina[tç][aã]o|pagination|otimiz|response times|query performance|performance bottlenecks?/i],
  ['background-jobs', /\bsidekiq\b|background|ass[ií]ncrono|async|jobs?\/dia/i],
  ['integracoes', /\bwebhook|integra[cç]/i],
  ['realtime', /\baction cable\b|real-?time|georrefer|georeferenced/i],
  ['observabilidade', /\bnew relic\b|\bdatadog\b|\bsentry\b|\bsplunk\b|\bappsignal\b|monitor|observability|logging|metrics|troubleshoot/i],
  ['cicd', /\bci\/cd\b|github actions|pipeline|deployment|deploy/i],
  ['cloud', /\baws\b|\bec2\b|\brds\b|\bs3\b|\blambda/i],
  ['producao', /produ[cç][aã]o|production|em produ[cç][aã]o|on-call|uptime|incident|high-availability|high availability/i],
];

const TECH_VOCAB: [string, string, boolean][] = [
  ['Ruby', '\\bruby\\b', true],
  ['Rails', '\\bruby on rails\\b|\\brails\\b', true],
  ['PHP', '\\bphp\\b', true],
  ['Laravel', '\\blaravel\\b', true],
  ['Symfony', '\\bsymfony\\b', true],
  ['Zend', '\\bzend\\b', true],
  ['Python', '\\bpython\\b', true],
  ['JavaScript', '\\bjavascript\\b', true],
  ['TypeScript', '\\btypescript\\b', true],
  ['Vue', '\\bvue(\\.js|js)?\\b', true],
  ['Ember', '\\bember(\\.js|js)?\\b', true],
  ['React', '\\breact\\b', true],
  ['Stimulus', '\\bstimulus\\b', true],
  ['jQuery', '\\bjquery\\b', true],
  ['HAML', '\\bhaml\\b', true],
  ['PostgreSQL', '\\bpostgres(ql)?\\b', true],
  ['MySQL', '\\bmysql\\b', true],
  ['ElasticSearch', '\\belastic\\s?search\\b', true],
  ['Redis', '\\bredis\\b', true],
  ['ActiveRecord', '\\bactive\\s?record\\b', true],
  ['Sidekiq', '\\bsidekiq\\b', true],
  ['GraphQL', '\\bgraphql\\b', true],
  ['RSpec', '\\brspec\\b', true],
  ['FactoryBot', '\\bfactory\\s?bot\\b', true],
  ['Capybara', '\\bcapybara\\b', true],
  ['Cucumber', '\\bcucumber\\b', true],
  ['Jest', '\\bjest\\b', true],
  ['AWS', '\\baws\\b', true],
  ['EC2', '\\bec2\\b', true],
  ['S3', '\\bs3\\b', true],
  ['RDS', '\\brds\\b', true],
  ['Lambda', '\\blambda\\b', true],
  ['Docker', '\\bdocker\\b', true],
  ['Kubernetes', '\\bkubernetes\\b', true],
  ['Terraform', '\\bterraform\\b', true],
  ['GitHub Actions', '\\bgithub actions\\b', true],
  ['GitLab', '\\bgitlab\\b', true],
  ['Jenkins', '\\bjenkins\\b', true],
  ['Capistrano', '\\bcapistrano\\b', true],
  ['Datadog', '\\bdatadog\\b', true],
  ['Sentry', '\\bsentry\\b', true],
  ['New Relic', '\\bnew relic\\b', true],
  ['AppSignal', '\\bappsignal\\b', true],
  ['Splunk', '\\bsplunk\\b', true],
  ['Claude Code', '\\bclaude code\\b', true],
  ['Cursor', '\\bcursor\\b', true],
  ['Copilot', '\\bcopilot\\b', true],
  ['ChatGPT', '\\bchatgpt\\b', true],
  ['Linux', '\\blinux\\b', true],
  ['Ubuntu', '\\bubuntu\\b', true],
  ['REST', '\\brest(ful)?\\b', false],
  ['TDD', '\\btdd\\b', false],
  ['CI/CD', '\\bci\\/cd\\b', false],
  ['observability', '\\bobservab\\w+\\b', false],
  ['monitoring', '\\bmonitor\\w*\\b', false],
  ['logging', '\\blogging\\b|\\blogs\\b', false],
  ['metrics', '\\bmetrics\\b', false],
  ['Agile', '\\bagile\\b', false],
  ['Scrum', '\\bscrum\\b', false],
  ['mentoring', '\\bmentor\\w*\\b', false],
  ['code review', '\\bcode reviews?\\b', false],
  ['documentation', '\\bdocumentation\\b', false],
  ['microservices', '\\bmicroservices?\\b', false],
  ['service objects', '\\bservice objects?\\b', false],
  ['background jobs', '\\bbackground jobs?\\b', false],
  ['migrations', '\\bmigrations?\\b', false],
  ['Git', '\\bgit\\b', false],
  ['React Native', '\\breact\\s?native\\b', true],
  ['ElastiCache', '\\belasti[-\\s]?cache\\b', true],
];

/** Evidence from the base belongs to another context (React Native mobile). */
const EXCLUDED_TERMS = new Set(['React']);

export interface CoverageTerm {
  term: string;
  src: string;
  baseHits?: number;
  jobSnippet?: string;
  baseSnippet?: string;
}

export interface CoverageTerms {
  mustCover: CoverageTerm[];
  forbidden: CoverageTerm[];
  coreKept: CoverageTerm[];
}

function countHits(text: unknown, source: string): number {
  try {
    const matches = String(text ?? '').match(new RegExp(source, 'gi'));
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

function jobSnippet(text: unknown, source: string): string {
  try {
    const match = new RegExp(source, 'i').exec(String(text ?? ''));
    if (!match) return '';
    return String(text)
      .slice(Math.max(0, match.index - 60), match.index + 80)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  } catch {
    return '';
  }
}

/** Job x base intersection: genuine must-cover matches, forbidden proper
 *  nouns and the candidate's preserved core. */
export function extractCoverageTerms(
  jobText: unknown,
  baseText: unknown,
): CoverageTerms {
  const mustCover: CoverageTerm[] = [];
  const forbidden: CoverageTerm[] = [];
  const coreKept: CoverageTerm[] = [];
  for (const [term, src, proper] of TECH_VOCAB) {
    if (EXCLUDED_TERMS.has(term)) continue;
    const inJob = countHits(jobText, src) > 0;
    const baseHits = countHits(baseText, src);
    if (inJob && baseHits > 0) {
      mustCover.push({
        term,
        src,
        baseHits,
        jobSnippet: jobSnippet(jobText, src),
        baseSnippet: jobSnippet(baseText, src),
      });
    } else if (inJob && baseHits === 0 && proper) {
      forbidden.push({ term, src, jobSnippet: jobSnippet(jobText, src) });
    } else if (!inJob && proper && baseHits >= 5 && coreKept.length < 8) {
      coreKept.push({ term, src, baseHits });
    }
  }
  coreKept.sort((a, b) => (b.baseHits ?? 0) - (a.baseHits ?? 0));
  return { mustCover, forbidden, coreKept };
}

function monthIndex(name: string, year: string): number {
  const key = String(name ?? '').toLowerCase().replace('ç', 'c');
  return Number(year) * 12 + (MONTH_IDX[key] ?? 0);
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function fmtDur(months: number): string {
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return years > 0
    ? `${years}a${remainder > 0 ? ` ${remainder}m` : ''}`
    : `${remainder}m`;
}

function monthLabel(index: number): string {
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${names[index % 12]}/${Math.floor(index / 12)}`;
}

interface ExperienceBlock {
  start: number;
  end: number;
  text: string;
  nonDev: boolean;
}

function extractBlocks(rawText: unknown): ExperienceBlock[] {
  const full = String(rawText ?? '');
  const eduIdx = full.search(/\nEducation\b/);
  const text = eduIdx >= 0 ? full.slice(0, eduIdx) : full;
  DATE_RE.lastIndex = 0;
  const matches = [...text.matchAll(DATE_RE)];
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  return matches
    .map((match, index) => {
      const start = monthIndex(match[1], match[2]);
      const end = match[5] ? monthIndex(match[4], match[5]) : nowIdx;
      const blockStart = Math.max(
        index === 0
          ? 0
          : matches[index - 1].index! + matches[index - 1][0].length,
        match.index! - 300,
      );
      const blockEnd =
        index + 1 < matches.length
          ? matches[index + 1].index!
          : Math.min(match.index! + 4000, text.length);
      const blockText = text.slice(blockStart, blockEnd);
      const beforeLines = text
        .slice(0, match.index)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-3)
        .join(' | ');
      const nonDev =
        /teacher|professor|lecturer|docente/i.test(beforeLines) &&
        !/develop|desenvol|engineer|software|system|sistema|web|tech/i.test(
          beforeLines,
        );
      return { start, end: Math.max(end, start), text: blockText, nonDev };
    })
    .filter((block) => !block.nonDev);
}

export interface StackExperience {
  months: number;
  blocks: number;
  mentions: number;
}

export interface ProfileEvidence {
  signal: string;
  snippet: string;
}

export interface AnalyzedProfile {
  computedAt: string;
  jobs: number;
  earliest: string | null;
  totalMonths: number;
  totalLabel: string;
  gapMonths: number;
  stacks: Record<string, StackExperience>;
  evidence: ProfileEvidence[];
}

export function analyzeProfile(rawText: unknown): AnalyzedProfile {
  const blocks = extractBlocks(rawText);
  const intervals = blocks.map(
    (block) => [block.start, block.end] as [number, number],
  );
  const merged = mergeIntervals(intervals);
  const totalMonths = merged.reduce(
    (acc, [start, end]) => acc + (end - start),
    0,
  );
  const spanMonths = merged.length
    ? merged[merged.length - 1][1] - merged[0][0]
    : 0;

  const stacks: Record<string, StackExperience> = {};
  for (const [name, regex] of STACKS) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const global = new RegExp(regex.source, flags);
    let mentions = 0;
    const stackIntervals: [number, number][] = [];
    for (const block of blocks) {
      const hits = [...block.text.matchAll(global)].length;
      if (!hits) continue;
      mentions += hits;
      stackIntervals.push([block.start, block.end]);
    }
    if (!stackIntervals.length) continue;
    const months = mergeIntervals(stackIntervals).reduce(
      (acc, [start, end]) => acc + (end - start),
      0,
    );
    if (months >= 6) stacks[name] = { months, blocks: stackIntervals.length, mentions };
  }

  const evidence: ProfileEvidence[] = [];
  for (const [signal, regex] of SIGNALS) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const global = new RegExp(regex.source, flags);
    let count = 0;
    for (const match of String(rawText ?? '').matchAll(global)) {
      if (count >= 2) break;
      const snippet = String(rawText)
        .slice(Math.max(0, match.index! - 60), match.index! + 80)
        .replace(/\s+/g, ' ')
        .trim();
      evidence.push({ signal, snippet });
      count++;
    }
    if (evidence.length >= 12) break;
  }

  return {
    computedAt: new Date().toISOString(),
    jobs: blocks.length,
    earliest: merged.length ? monthLabel(merged[0][0]) : null,
    totalMonths,
    totalLabel: fmtDur(totalMonths),
    gapMonths: spanMonths - totalMonths,
    stacks: Object.fromEntries(
      Object.entries(stacks).sort((a, b) => b[1].months - a[1].months),
    ),
    evidence: evidence.slice(0, 12),
  };
}

export interface ClassifiedRequirements {
  mustHave: string[];
  differentials: string[];
}

/** Pre-classifies job requirements into must-have vs differentials. */
export function classifyRequirements(content: unknown): ClassifiedRequirements {
  const diffCues =
    /will help you succeed|nice to have|\bbonus\b|differential|diferencial|desej[áa]vel|\bplus\b|great if|preferred/i;
  const diffHeader =
    /will help you succeed|nice to have|bonus|diferencial|desej[áa]vel|preferred|desirable|good to have/i;
  const mustHeader =
    /role overview|what you do|qualifications|you have|you bring|requirements|responsibilities|must have|required|requisitos|responsabilidades|atividades|what you.ll do|about the role/i;
  const skipHeader =
    /we also offer|^benefits|compensation|perks|let.s talk numbers|privacy notice|equal opportunity|\beeo\b/i;
  const isHeaderLike = (line: string): boolean =>
    line.length < 120 &&
    (diffHeader.test(line) || mustHeader.test(line) || skipHeader.test(line));
  const rawLines = String(content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines: string[] = [];
  for (const line of rawLines) {
    if (line.length <= 40 && !isHeaderLike(line)) continue;
    const parts =
      line.length > 220
        ? line
            .split(/(?<=[.!?])\s+/)
            .map((part) => part.trim())
            .filter((part) => part.length > 40)
        : [line];
    lines.push(...parts);
    if (lines.length > 80) break;
  }
  let mode = 'skip';
  const mustHave: string[] = [];
  const differentials: string[] = [];
  for (const line of lines) {
    const short = line.length > 160 ? `${line.slice(0, 160)}…` : line;
    if (line.length < 120 && skipHeader.test(line)) {
      mode = 'skip';
      continue;
    }
    if (line.length < 120 && diffHeader.test(line)) {
      mode = 'diff';
      continue;
    }
    if (line.length < 120 && mustHeader.test(line)) {
      mode = 'must';
      continue;
    }
    if (mode === 'skip') continue;
    if (diffCues.test(line)) {
      if (differentials.length < 8) differentials.push(short);
    } else if (mode === 'must') {
      if (mustHave.length < 12) mustHave.push(short);
    } else if (differentials.length < 8) {
      differentials.push(short);
    }
  }
  if (!mustHave.length && !differentials.length) {
    return { mustHave: lines.slice(0, 12), differentials: [] };
  }
  return { mustHave, differentials };
}

export function formatProfileSection(profile: AnalyzedProfile): string {
  const stackLine =
    Object.entries(profile.stacks)
      .map(([name, data]) => `${name} ${fmtDur(data.months)} · ${data.blocks} bloco(s)`)
      .join(' | ') || '-';
  const evidenceLines = (profile.evidence || [])
    .map((entry) => `- [${entry.signal}] …${entry.snippet}…`)
    .join('\n');
  return `Carreira dev: ${profile.totalLabel} (${profile.earliest || '?'}→presente, overlaps fundidos, ${profile.jobs} cargos dev)\nStacks citados por período (heurística: só alegue PRODUÇÃO com 2+ blocos; 1 bloco = contato superficial): ${stackLine}\nEvidências (trechos literais do CV):\n${evidenceLines || '-'}`;
}

/** Ready-to-prompt profile section. The v1 file cache is intentionally gone
 *  (D1: no filesystem state; the DB is the source of truth). */
export function getProfileSection(rawText: unknown): string {
  return formatProfileSection(analyzeProfile(rawText));
}
