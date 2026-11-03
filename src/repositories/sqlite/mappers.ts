import type { Artifact } from '../../domain/artifact.js';
import {
  fitSchema,
  type Fit,
  type Job,
  type Language,
  type JobStatus,
} from '../../domain/job.js';
import type { JobSnapshot, Run } from '../../domain/run.js';
import type {
  ArtifactRow,
  JobRow,
  NewJobRow,
  NewRunRow,
  RunRow,
} from '../../db/schema.js';

const LANGUAGES = new Set<Language>(['pt-br', 'en']);

function asLanguage(value: string | null | undefined): Language {
  return value === 'en' ? 'en' : 'pt-br';
}

function asStatus(value: string | null | undefined): JobStatus {
  switch (value) {
    case 'drafted':
    case 'applied':
    case 'interview':
    case 'offer':
    case 'rejected':
    case 'archived':
      return value;
    default:
      return 'drafted';
  }
}

export function parseFit(value: unknown): Fit | null {
  if (value === null || value === undefined) return null;
  const parsed = fitSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseJobSnapshot(value: unknown): JobSnapshot | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JobSnapshot;
}

/**
 * O Firestore não tem `undefined`: convertemos tudo para `null`, o que também
 * deixa o JSON do SQLite previsível.
 */
function nullify<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

export function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    ownerId: row.ownerId,
    company: row.company,
    role: row.role,
    vacancyUrl: row.vacancyUrl,
    applyUrl: row.applyUrl,
    language: asLanguage(row.language),
    stack: row.stack,
    channel: row.channel,
    languageConfirmation: row.languageConfirmation,
    status: asStatus(row.status),
    appliedAt: row.appliedAt,
    fit: parseFit(row.fitJson),
    appliedEmails: Array.isArray(row.appliedEmails) ? row.appliedEmails : [],
    coverLetterGuidance: row.coverLetterGuidance,
    coverInCvRequired: row.coverInCvRequired,
    coverInCvReason: row.coverInCvReason,
    hasRecruiterMessage: Boolean(row.hasRecruiterMessage),
    hasQuestions: Boolean(row.hasQuestions),
    skillGrounded: row.skillGrounded,
    fitConfirmed: row.fitConfirmed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function jobToRow(job: Job): NewJobRow {
  const fit = parseFit(job.fit);
  return {
    id: job.id,
    ownerId: job.ownerId,
    company: job.company,
    role: job.role,
    vacancyUrl: nullify(job.vacancyUrl),
    applyUrl: nullify(job.applyUrl),
    language: LANGUAGES.has(job.language) ? job.language : 'pt-br',
    stack: job.stack,
    channel: nullify(job.channel),
    languageConfirmation: nullify(job.languageConfirmation),
    status: asStatus(job.status),
    appliedAt: nullify(job.appliedAt),
    fitRating: fit?.rating ?? null,
    fitAnalysis: fit?.analysis ?? null,
    fitJson: fit,
    appliedEmails: job.appliedEmails,
    coverLetterGuidance: nullify(job.coverLetterGuidance),
    coverInCvRequired: nullify(job.coverInCvRequired),
    coverInCvReason: nullify(job.coverInCvReason),
    hasRecruiterMessage: Boolean(job.hasRecruiterMessage),
    hasQuestions: Boolean(job.hasQuestions),
    skillGrounded: nullify(job.skillGrounded),
    fitConfirmed: nullify(job.fitConfirmed),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    jobId: row.jobId,
    stage: row.stage,
    url: row.url,
    stack: row.stack,
    languagePreference: row.languagePreference,
    detectedLanguage: row.detectedLanguage,
    suggestedLanguage: row.suggestedLanguage,
    needsLanguageConfirmation: Boolean(row.needsLanguageConfirmation),
    needsFitConfirmation: Boolean(row.needsFitConfirmation),
    eligibilityBlocked: Boolean(row.eligibilityBlocked),
    hasRawText: Boolean(row.hasRawText),
    hasExtraQuestions: Boolean(row.hasExtraQuestions),
    hasRecruiterMessage: Boolean(row.hasRecruiterMessage),
    error: row.error,
    fit: parseFit(row.fitJson),
    job: parseJobSnapshot(row.jobJson),
    jobSnapshot: parseJobSnapshot(row.jobSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function runToRow(run: Run): NewRunRow {
  return {
    id: run.id,
    jobId: nullify(run.jobId),
    stage: run.stage,
    url: nullify(run.url),
    stack: nullify(run.stack),
    languagePreference: nullify(run.languagePreference),
    detectedLanguage: nullify(run.detectedLanguage),
    suggestedLanguage: nullify(run.suggestedLanguage),
    needsLanguageConfirmation: Boolean(run.needsLanguageConfirmation),
    needsFitConfirmation: Boolean(run.needsFitConfirmation),
    eligibilityBlocked: Boolean(run.eligibilityBlocked),
    hasRawText: Boolean(run.hasRawText),
    hasExtraQuestions: Boolean(run.hasExtraQuestions),
    hasRecruiterMessage: Boolean(run.hasRecruiterMessage),
    error: nullify(run.error),
    fitJson: parseFit(run.fit),
    jobJson: nullify(run.job),
    jobSnapshot: nullify(run.jobSnapshot),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    jobId: row.jobId,
    runId: row.runId,
    kind: row.kind,
    relativePath: row.relativePath,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}
