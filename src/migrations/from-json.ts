import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { ArtifactKind } from '../domain/artifact.js';
import {
  fitSchema,
  type Fit,
  type JobStatus,
  type NewJob,
} from '../domain/job.js';
import type { JobSnapshot, NewRun } from '../domain/run.js';
import { defaultDbFile } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import type { NewArtifact } from '../repositories/types.js';
import { createStore } from '../repositories/sqlite/store.js';

/* ------------------------------------------------------------------ */
/* Formatos legados (v1)                                              */
/* ------------------------------------------------------------------ */

interface LegacyJob {
  id?: string;
  date?: string;
  company?: string;
  role?: string;
  language?: string;
  stack?: string;
  channel?: string;
  appliedEmails?: string[];
  fitRating?: number;
  fitAnalysis?: string;
  fitDimensions?: Record<string, unknown>;
  skillsMatch?: number;
  experienceMatch?: number;
  logisticsMatch?: number;
  cultureMatch?: number;
  strengths?: string[];
  gaps?: string[];
  eligibility?: { passed?: boolean; reason?: string };
  languageGate?: { required?: string; passed?: boolean; note?: string | null };
  logisticsNote?: string | null;
  skillGrounded?: boolean;
  fitConfirmed?: boolean;
  status?: string;
  vacancyUrl?: string;
  applyUrl?: string;
  appliedAt?: string;
  coverLetterGuidance?: string;
  coverInCvRequired?: boolean;
  coverInCvReason?: string;
  hasRecruiterMessage?: boolean;
  hasQuestions?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface LegacyRun {
  id?: string;
  applicationId?: string;
  stage?: string;
  url?: string;
  hasRawText?: boolean;
  hasExtraQuestions?: boolean;
  hasRecruiterMessage?: boolean;
  languagePreference?: string;
  detectedLanguage?: string;
  suggestedLanguage?: string;
  needsLanguageConfirmation?: boolean;
  needsFitConfirmation?: boolean;
  eligibilityBlocked?: boolean;
  error?: string | null;
  job?: {
    title?: string;
    company?: string;
    location?: string;
    url?: string;
    applyUrl?: string;
    detectedLanguage?: string;
  };
  fit?: LegacyJob;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ImportOptions {
  trackerFile: string;
  processesFile?: string;
  applicationsDir?: string;
  baseProfileDir?: string;
  dbFile?: string;
  reset?: boolean;
}

export interface ImportReport {
  jobs: number;
  runs: number;
  runsWithoutJob: number;
  artifacts: number;
  profiles: number;
  settings: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_MAP: Record<string, JobStatus> = {
  drafted: 'drafted',
  rascunho: 'drafted',
  applied: 'applied',
  aplicado: 'applied',
  interview: 'interview',
  entrevista: 'interview',
  offer: 'offer',
  proposta: 'offer',
  rejected: 'rejected',
  encerrado: 'rejected',
  closed: 'rejected',
  archived: 'archived',
  arquivado: 'archived',
};

const ARTIFACT_FIELDS: Array<[string, ArtifactKind]> = [
  ['cvHtmlFile', 'cv_html'],
  ['cvPdfFile', 'cv_pdf'],
  ['coverLetterPdf', 'cover_letter_pdf'],
  ['coverLetterHtmlFile', 'cover_letter_html'],
  ['cvWithCoverHtmlFile', 'cv_with_cover_html'],
  ['cvWithCoverPdfFile', 'cv_with_cover_pdf'],
  ['emailTextFile', 'email_text'],
  ['linkedInNoteFile', 'linkedin_note'],
  ['recruiterNoteFile', 'recruiter_note'],
  ['questionsFile', 'questions'],
  ['suggestionsFile', 'suggestions'],
  ['jobPostingFile', 'job_posting'],
];

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readJsonIfExists<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson<T>(file);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Converte "28/10/2026" em ISO, ancorando ao meio-dia UTC para não deslocar o dia. */
export function parseLegacyDate(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

    const isRealDate =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;

    return isRealDate ? date.toISOString() : null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStatus(value: unknown, warnings: string[]): JobStatus {
  const raw = stringOrNull(value)?.toLowerCase();
  if (!raw) return 'drafted';
  const status = STATUS_MAP[raw];
  if (!status) {
    warnings.push(`Status desconhecido "${raw}" convertido para "drafted".`);
    return 'drafted';
  }
  return status;
}

function normalizeFit(source: LegacyJob | null | undefined): Fit | null {
  if (!source) return null;

  const dimensions: Record<string, number> = {};
  const dimensionKeys = [
    'skillsMatch',
    'experienceMatch',
    'logisticsMatch',
    'cultureMatch',
  ] as const;

  const flatSource = source as Record<string, unknown>;
  const nested =
    source.fitDimensions && typeof source.fitDimensions === 'object'
      ? (source.fitDimensions as Record<string, unknown>)
      : {};

  for (const key of dimensionKeys) {
    const value = numberOrNull(flatSource[key] ?? nested[key]);
    if (value !== null) dimensions[key] = value;
  }

  const eligibility =
    source.eligibility && typeof source.eligibility === 'object'
      ? {
          passed: Boolean(source.eligibility.passed),
          reason: String(source.eligibility.reason ?? ''),
        }
      : null;

  const languageGate =
    source.languageGate && typeof source.languageGate === 'object'
      ? {
          required: String(source.languageGate.required ?? ''),
          passed: Boolean(source.languageGate.passed),
          note: source.languageGate.note ?? null,
        }
      : null;

  const parsed = fitSchema.safeParse({
    rating: numberOrNull(source.fitRating ?? source.rating),
    analysis: stringOrNull(source.fitAnalysis ?? source.analysis),
    dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
    strengths: Array.isArray(source.strengths) ? source.strengths : [],
    gaps: Array.isArray(source.gaps) ? source.gaps : [],
    eligibility,
    languageGate,
    logisticsNote: stringOrNull(source.logisticsNote),
  });

  return parsed.success ? parsed.data : null;
}

function toRelativeArtifactPath(value: string): string {
  // v1 grava "/applications/pasta/arquivo.ext"
  return value
    .trim()
    .replace(/^\/?applications\//, '')
    .replace(/^\/+/, '');
}

function mimeFor(relativePath: string): string | null {
  return MIME_BY_EXT[path.extname(relativePath).toLowerCase()] ?? null;
}

function sizeFor(
  applicationsDir: string | undefined,
  relativePath: string,
): number | null {
  if (!applicationsDir) return null;
  try {
    return fs.statSync(path.join(applicationsDir, relativePath)).size;
  } catch {
    return null;
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/* ------------------------------------------------------------------ */
/* Importação                                                         */
/* ------------------------------------------------------------------ */

export function importFromJson(options: ImportOptions): ImportReport {
  const tracker = readJson<LegacyJob[]>(options.trackerFile);
  if (!Array.isArray(tracker)) {
    throw new Error(`Tracker inválido (esperado array): ${options.trackerFile}`);
  }

  const processes =
    options.processesFile && fs.existsSync(options.processesFile)
      ? readJson<LegacyRun[]>(options.processesFile)
      : [];

  const store = createStore(options.dbFile ?? defaultDbFile());

  try {
    runMigrations(store.db);

    if (!options.reset && store.jobs.list({ limit: 1 }).total > 0) {
      throw new Error(
        'O banco já contém vagas. Use --reset para limpar antes de importar.',
      );
    }

    return store.transaction(() => {
      if (options.reset) {
        store.sqlite.exec(
          'DELETE FROM artifacts; DELETE FROM runs; DELETE FROM jobs; DELETE FROM profiles; DELETE FROM settings;',
        );
      }

      const warnings: string[] = [];
      const importedJobIds = new Set<string>();
      const jobIdsByUrl = new Map<string, string>();
      let artifactCount = 0;

      for (const legacy of tracker) {
        if (!legacy?.id) {
          warnings.push('Vaga sem id ignorada.');
          continue;
        }
        if (importedJobIds.has(legacy.id)) {
          warnings.push(`Vaga duplicada ignorada: ${legacy.id}.`);
          continue;
        }

        const appliedAt = parseLegacyDate(legacy.date ?? legacy.appliedAt);
        if (!appliedAt && (legacy.date || legacy.appliedAt)) {
          warnings.push(
            `Data inválida na vaga ${legacy.id}: ${String(legacy.date ?? legacy.appliedAt)}.`,
          );
        }

        const job: NewJob = {
          id: legacy.id,
          company: stringOrNull(legacy.company) ?? 'Empresa a confirmar',
          role: stringOrNull(legacy.role) ?? 'Vaga sem título',
          vacancyUrl: stringOrNull(legacy.vacancyUrl),
          applyUrl: stringOrNull(legacy.applyUrl),
          language: legacy.language === 'en' ? 'en' : 'pt-br',
          stack: stringOrNull(legacy.stack)?.toLowerCase() ?? 'ruby',
          channel: stringOrNull(legacy.channel),
          status: normalizeStatus(legacy.status, warnings),
          appliedAt,
          fit: normalizeFit(legacy),
          appliedEmails: Array.isArray(legacy.appliedEmails)
            ? legacy.appliedEmails
            : [],
          coverLetterGuidance: stringOrNull(legacy.coverLetterGuidance),
          coverInCvRequired:
            typeof legacy.coverInCvRequired === 'boolean'
              ? legacy.coverInCvRequired
              : null,
          coverInCvReason: stringOrNull(legacy.coverInCvReason),
          hasRecruiterMessage: Boolean(legacy.hasRecruiterMessage),
          hasQuestions: Boolean(legacy.hasQuestions),
          skillGrounded:
            typeof legacy.skillGrounded === 'boolean'
              ? legacy.skillGrounded
              : null,
          fitConfirmed:
            typeof legacy.fitConfirmed === 'boolean'
              ? legacy.fitConfirmed
              : null,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt,
        };

        store.jobs.create(job);
        importedJobIds.add(job.id as string);

        const urls = [job.vacancyUrl, job.applyUrl].filter(
          (url): url is string => Boolean(url),
        );
        for (const url of urls) jobIdsByUrl.set(url, job.id as string);

        const artifacts: NewArtifact[] = [];
        for (const [field, kind] of ARTIFACT_FIELDS) {
          const raw = legacy[field];
          if (typeof raw !== 'string' || raw.trim().length === 0) continue;

          const relativePath = toRelativeArtifactPath(raw);
          artifacts.push({
            jobId: job.id as string,
            runId: null,
            kind,
            relativePath,
            mime: mimeFor(relativePath),
            sizeBytes: sizeFor(options.applicationsDir, relativePath),
          });
        }

        store.artifacts.addMany(artifacts);
        artifactCount += artifacts.length;
      }

      let runCount = 0;
      let runsWithoutJob = 0;

      for (const legacy of processes) {
        if (!legacy?.id) {
          warnings.push('Processo sem id ignorado.');
          continue;
        }

        const applicationId = stringOrNull(legacy.applicationId);
        const url = stringOrNull(legacy.url);
        const snapshotUrl = stringOrNull(legacy.job?.url);
        const snapshotApplyUrl = stringOrNull(legacy.job?.applyUrl);

        let jobId: string | null = null;
        if (applicationId && importedJobIds.has(applicationId)) {
          jobId = applicationId;
        }
        for (const candidate of [url, snapshotUrl, snapshotApplyUrl]) {
          if (jobId || !candidate) continue;
          jobId = jobIdsByUrl.get(candidate) ?? null;
        }

        if (!jobId) runsWithoutJob += 1;

        const snapshot: JobSnapshot | null = legacy.job
          ? compactObject({
              title: legacy.job.title,
              company: legacy.job.company,
              location: legacy.job.location,
              url: legacy.job.url,
              applyUrl: legacy.job.applyUrl,
              detectedLanguage: legacy.job.detectedLanguage,
            })
          : null;

        const run: NewRun = {
          id: legacy.id,
          jobId,
          stage: stringOrNull(legacy.stage) ?? 'draft',
          url,
          languagePreference: stringOrNull(legacy.languagePreference),
          detectedLanguage: stringOrNull(legacy.detectedLanguage),
          suggestedLanguage: stringOrNull(legacy.suggestedLanguage),
          needsLanguageConfirmation: Boolean(
            legacy.needsLanguageConfirmation,
          ),
          needsFitConfirmation: Boolean(legacy.needsFitConfirmation),
          eligibilityBlocked: Boolean(legacy.eligibilityBlocked),
          hasRawText: Boolean(legacy.hasRawText),
          hasExtraQuestions: Boolean(legacy.hasExtraQuestions),
          hasRecruiterMessage: Boolean(legacy.hasRecruiterMessage),
          error: stringOrNull(legacy.error),
          fit: normalizeFit(legacy.fit),
          jobSnapshot: snapshot,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt,
        };

        store.runs.create(run);
        runCount += 1;
      }

      let profileCount = 0;
      const baseProfileDir = options.baseProfileDir;
      if (baseProfileDir) {
        const profileFiles: Array<{
          stack: string;
          language: string;
          file: string;
        }> = [
          { stack: 'ruby', language: 'pt-br', file: 'perfil_base_pt_br.json' },
          { stack: 'ruby', language: 'en', file: 'perfil_base_en.json' },
          {
            stack: 'php',
            language: 'pt-br',
            file: 'perfil_base_php_pt_br.json',
          },
          { stack: 'php', language: 'en', file: 'perfil_base_php_en.json' },
        ];

        for (const entry of profileFiles) {
          const file = path.join(baseProfileDir, entry.file);
          const content = readJsonIfExists(file);
          if (content === null) continue;
          store.profiles.upsert({
            stack: entry.stack,
            language: entry.language,
            content,
          });
          profileCount += 1;
        }
      }

      let settingsCount = 0;
      if (baseProfileDir) {
        const settingsFiles: Array<[string, string]> = [
          ['pdf_theme', 'pdf-theme.json'],
          ['perfil_calculado', 'perfil_calculado.json'],
          ['candidate_form', 'dados_formulario.json'],
        ];

        for (const [key, file] of settingsFiles) {
          const content = readJsonIfExists(path.join(baseProfileDir, file));
          if (content === null) continue;
          store.settings.set(key, content);
          settingsCount += 1;
        }

        if (fs.existsSync(path.join(baseProfileDir, 'config.json'))) {
          warnings.push(
            'config.json não importado de propósito: contém chave de API da LLM. Reconfigure no v2.',
          );
        }
      }

      if (runsWithoutJob > 0) {
        warnings.push(
          `${runsWithoutJob} processo(s) sem vaga correspondente (jobId nulo).`,
        );
      }

      return {
        jobs: importedJobIds.size,
        runs: runCount,
        runsWithoutJob,
        artifacts: artifactCount,
        profiles: profileCount,
        settings: settingsCount,
        warnings,
      };
    });
  } finally {
    store.close();
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { values } = parseArgs({
    options: {
      tracker: { type: 'string' },
      processes: { type: 'string' },
      applications: { type: 'string' },
      'base-profile': { type: 'string' },
      db: { type: 'string' },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(`Uso: pnpm db:import [opções]

  --tracker <arquivo>       job_search_tracker.json (v1)
  --processes <arquivo>     job_processes.json (v1)
  --applications <dir>      pasta applications/ (v1)
  --base-profile <dir>      pasta base_profile/ (v1)
  --db <arquivo>            destino SQLite (padrão: data/job-search.db)
  --reset                   limpa as tabelas antes de importar
`);
    process.exit(0);
  }

  const legacyDir = path.resolve('..', 'job-search');
  const resolvePath = (value: string | undefined, fallback: string): string =>
    path.resolve(value ?? fallback);

  const report = importFromJson({
    trackerFile: resolvePath(
      values.tracker,
      path.join(legacyDir, 'job_search_tracker.json'),
    ),
    processesFile: resolvePath(
      values.processes,
      path.join(legacyDir, 'job_processes.json'),
    ),
    applicationsDir: resolvePath(
      values.applications,
      path.join(legacyDir, 'applications'),
    ),
    baseProfileDir: resolvePath(
      values['base-profile'],
      path.join(legacyDir, 'base_profile'),
    ),
    dbFile: resolvePath(values.db, defaultDbFile()),
    reset: values.reset,
  });

  console.log('Importação concluída:');
  console.log(`  vagas:     ${report.jobs}`);
  console.log(`  processos: ${report.runs} (${report.runsWithoutJob} sem vaga)`);
  console.log(`  artefatos: ${report.artifacts}`);
  console.log(`  perfis:    ${report.profiles}`);
  console.log(`  settings:  ${report.settings}`);

  if (report.warnings.length > 0) {
    console.log('\nAvisos:');
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
}
