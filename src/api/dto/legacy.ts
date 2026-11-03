import type { Artifact, ArtifactKind } from '../../domain/artifact.js';
import { isoToBrDate, parseLegacyDate } from '../../domain/dates.js';
import type {
  Fit,
  FitDimensions,
  Job,
  JobPatch,
  JobStatus,
} from '../../domain/job.js';
import type { JobSnapshot, Run, RunPatch } from '../../domain/run.js';

/**
 * Camada de tradução para o formato que a UI do v1 consome.
 * Ela existe só enquanto o React não assume; o domínio continua limpo.
 */

const LEGACY_STATUS: Record<string, JobStatus> = {
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
  desistido: 'rejected',
  archived: 'archived',
  arquivado: 'archived',
};

const ARTIFACT_TO_FIELD: Partial<Record<ArtifactKind, string>> = {
  cv_html: 'cvHtmlFile',
  cv_pdf: 'cvPdfFile',
  cover_letter_pdf: 'coverLetterPdf',
  cover_letter_html: 'coverLetterHtmlFile',
  cv_with_cover_html: 'cvWithCoverHtmlFile',
  cv_with_cover_pdf: 'cvWithCoverPdfFile',
  email_text: 'emailTextFile',
  linkedin_note: 'linkedInNoteFile',
  recruiter_note: 'recruiterNoteFile',
  questions: 'questionsFile',
  suggestions: 'suggestionsFile',
  job_posting: 'jobPostingFile',
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeLegacyStatus(value: unknown): JobStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return LEGACY_STATUS[value.trim().toLowerCase()];
}

export function toLegacyFit(
  fit: Fit | null,
  snapshot: JobSnapshot | null,
): Record<string, unknown> {
  return {
    company: snapshot?.company ?? null,
    role: snapshot?.title ?? null,
    ...(fit?.dimensions ?? {}),
    fitRating: fit?.rating ?? null,
    fitAnalysis: fit?.analysis ?? null,
    strengths: fit?.strengths ?? [],
    gaps: fit?.gaps ?? [],
    eligibility: fit?.eligibility ?? null,
    languageGate: fit?.languageGate ?? null,
    logisticsNote: fit?.logisticsNote ?? null,
  };
}

export function toLegacyApplication(
  job: Job,
  artifacts: Artifact[],
): Record<string, unknown> {
  const files = new Map<string, string>();
  for (const artifact of artifacts) {
    files.set(artifact.kind, `/applications/${artifact.relativePath}`);
  }

  // O v1 normalizava os dois links de recrutador como fallback um do outro.
  if (!files.has('recruiter_note') && files.has('linkedin_note')) {
    files.set('recruiter_note', files.get('linkedin_note') as string);
  }
  if (!files.has('linkedin_note') && files.has('recruiter_note')) {
    files.set('linkedin_note', files.get('recruiter_note') as string);
  }

  const fileFields: Record<string, string | null> = {};
  for (const [kind, field] of Object.entries(ARTIFACT_TO_FIELD)) {
    fileFields[field] = files.get(kind) ?? null;
  }

  return {
    id: job.id,
    date: isoToBrDate(job.appliedAt ?? job.createdAt),
    company: job.company,
    role: job.role,
    language: job.language,
    languageConfirmation: job.languageConfirmation,
    stack: job.stack,
    channel: job.channel,
    appliedEmails: job.appliedEmails,
    fitRating: job.fit?.rating ?? null,
    fitAnalysis: job.fit?.analysis ?? null,
    fitDimensions: job.fit?.dimensions ?? {},
    strengths: job.fit?.strengths ?? [],
    gaps: job.fit?.gaps ?? [],
    eligibility: job.fit?.eligibility ?? null,
    languageGate: job.fit?.languageGate ?? null,
    logisticsNote: job.fit?.logisticsNote ?? null,
    skillGrounded: job.skillGrounded,
    fitConfirmed: job.fitConfirmed,
    status: job.status,
    vacancyUrl: job.vacancyUrl,
    applyUrl: job.applyUrl,
    ...fileFields,
    coverInCvRequired: job.coverInCvRequired,
    coverInCvReason: job.coverInCvReason,
    coverLetterGuidance: job.coverLetterGuidance,
    hasRecruiterMessage: job.hasRecruiterMessage,
    hasQuestions: job.hasQuestions,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function toLegacyProcess(run: Run): Record<string, unknown> {
  const snapshot = run.jobSnapshot ?? run.job;
  return {
    id: run.id,
    applicationId: run.jobId,
    stage: run.stage,
    url: run.url,
    stack: run.stack,
    hasRawText: run.hasRawText,
    hasExtraQuestions: run.hasExtraQuestions,
    hasRecruiterMessage: run.hasRecruiterMessage,
    languagePreference: run.languagePreference,
    detectedLanguage: run.detectedLanguage,
    suggestedLanguage: run.suggestedLanguage,
    needsLanguageConfirmation: run.needsLanguageConfirmation,
    needsFitConfirmation: run.needsFitConfirmation,
    eligibilityBlocked: run.eligibilityBlocked,
    job: run.job,
    jobSnapshot: run.jobSnapshot,
    fit: run.fit ? toLegacyFit(run.fit, snapshot) : null,
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function mergeFit(current: Fit | null, body: Record<string, unknown>): Fit {
  const dimensions: FitDimensions = {
    ...(current?.dimensions ?? {}),
  };
  if (
    body.fitDimensions &&
    typeof body.fitDimensions === 'object' &&
    !Array.isArray(body.fitDimensions)
  ) {
    Object.assign(dimensions, body.fitDimensions as FitDimensions);
  }

  return {
    ...(current ?? { strengths: [], gaps: [] }),
    rating:
      'fitRating' in body
        ? numberOrNull(body.fitRating)
        : (current?.rating ?? null),
    analysis:
      'fitAnalysis' in body
        ? stringOrNull(body.fitAnalysis)
        : (current?.analysis ?? null),
    dimensions,
    strengths: Array.isArray(body.strengths)
      ? body.strengths.map(String)
      : (current?.strengths ?? []),
    gaps: Array.isArray(body.gaps)
      ? body.gaps.map(String)
      : (current?.gaps ?? []),
    eligibility:
      'eligibility' in body
        ? (body.eligibility as Fit['eligibility'])
        : current?.eligibility,
    languageGate:
      'languageGate' in body
        ? (body.languageGate as Fit['languageGate'])
        : current?.languageGate,
    logisticsNote:
      'logisticsNote' in body
        ? stringOrNull(body.logisticsNote)
        : (current?.logisticsNote ?? null),
  };
}

export function legacyApplicationPatch(
  current: Job,
  body: Record<string, unknown>,
): JobPatch {
  const patch: JobPatch = {};

  if ('status' in body) {
    const status = normalizeLegacyStatus(body.status);
    if (status) patch.status = status;
  }

  if ('language' in body) {
    patch.language = body.language === 'en' ? 'en' : 'pt-br';
  }
  if ('stack' in body) patch.stack = stringOrNull(body.stack) ?? 'ruby';
  if ('channel' in body) patch.channel = stringOrNull(body.channel) ?? 'portal';
  if ('vacancyUrl' in body) patch.vacancyUrl = stringOrNull(body.vacancyUrl);
  if ('applyUrl' in body) patch.applyUrl = stringOrNull(body.applyUrl);
  if ('coverLetterGuidance' in body) {
    patch.coverLetterGuidance = stringOrNull(body.coverLetterGuidance);
  }
  if ('coverInCvReason' in body) {
    patch.coverInCvReason = stringOrNull(body.coverInCvReason);
  }
  if ('coverInCvRequired' in body) {
    patch.coverInCvRequired = booleanOrNull(body.coverInCvRequired);
  }
  if ('skillGrounded' in body) {
    patch.skillGrounded = booleanOrNull(body.skillGrounded);
  }
  if ('fitConfirmed' in body) {
    patch.fitConfirmed = booleanOrNull(body.fitConfirmed);
  }
  if ('hasRecruiterMessage' in body) {
    patch.hasRecruiterMessage = Boolean(body.hasRecruiterMessage);
  }
  if ('hasQuestions' in body) {
    patch.hasQuestions = Boolean(body.hasQuestions);
  }
  if (Array.isArray(body.appliedEmails)) {
    patch.appliedEmails = body.appliedEmails.map(String);
  }
  if ('date' in body || 'appliedAt' in body) {
    patch.appliedAt = parseLegacyDate(body.appliedAt ?? body.date);
  }

  const fitKeys = [
    'fitRating',
    'fitAnalysis',
    'fitDimensions',
    'strengths',
    'gaps',
    'eligibility',
    'languageGate',
    'logisticsNote',
  ];
  if (fitKeys.some((key) => key in body)) {
    patch.fit = mergeFit(current.fit, body);
  }

  return patch;
}

export function legacyProcessPatch(body: Record<string, unknown>): RunPatch {
  const patch: RunPatch = {};

  if ('stage' in body) patch.stage = stringOrNull(body.stage) ?? 'draft';
  if ('url' in body) patch.url = stringOrNull(body.url);
  if ('stack' in body) patch.stack = stringOrNull(body.stack);
  if ('languagePreference' in body) {
    patch.languagePreference = stringOrNull(body.languagePreference);
  }
  if ('detectedLanguage' in body) {
    patch.detectedLanguage = stringOrNull(body.detectedLanguage);
  }
  if ('suggestedLanguage' in body) {
    patch.suggestedLanguage = stringOrNull(body.suggestedLanguage);
  }
  if ('needsLanguageConfirmation' in body) {
    patch.needsLanguageConfirmation = Boolean(body.needsLanguageConfirmation);
  }
  if ('needsFitConfirmation' in body) {
    patch.needsFitConfirmation = Boolean(body.needsFitConfirmation);
  }
  if ('eligibilityBlocked' in body) {
    patch.eligibilityBlocked = Boolean(body.eligibilityBlocked);
  }
  if ('hasRawText' in body) patch.hasRawText = Boolean(body.hasRawText);
  if ('hasExtraQuestions' in body) {
    patch.hasExtraQuestions = Boolean(body.hasExtraQuestions);
  }
  if ('hasRecruiterMessage' in body) {
    patch.hasRecruiterMessage = Boolean(body.hasRecruiterMessage);
  }
  if ('error' in body) patch.error = stringOrNull(body.error);
  if ('applicationId' in body) patch.jobId = stringOrNull(body.applicationId);
  if ('fit' in body) patch.fit = body.fit;
  if ('job' in body) patch.job = body.job;
  if ('jobSnapshot' in body) patch.jobSnapshot = body.jobSnapshot;

  return patch;
}
