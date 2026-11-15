import type { Job } from '../../domain/job.js';
import type { JobSnapshot, Run } from '../../domain/run.js';
import { normalizeLang, normalizeStack } from '../content.js';
import type { GenerateKitPayload } from '../queue.js';
import type { Store } from '../../repositories/types.js';

/**
 * Rebuilds a kit for an existing application (port of v1
 * `/api/applications/:id/regenerate`). v2 reuses the last run's posting
 * snapshot instead of re-scraping or reading `job_posting.md`, keeps the same
 * `job` row (so id/date/status survive), and asks the runner to copy the old
 * extras that the fresh generation did not produce.
 */

export interface RegenerateInput {
  languagePreference?: string | null;
  stack?: string | null;
  rawText?: string | null;
  extraQuestions?: string | null;
  recruiterMessage?: string | null;
  coverLetterGuidance?: string | null;
  /** Free-form notes applied to the regenerated materials. */
  guidance?: string | null;
  includeCoverInCv?: string | boolean | null;
  /** Artifact kinds to write; omitted means every kind. */
  artifacts?: string[] | null;
}

export type RegeneratePlan =
  | { status: 'not_found' }
  | { status: 'no_source'; error: string }
  | {
      status: 'language_conflict';
      error: string;
      jobRequiredLanguage: 'pt-br' | 'en';
      providedLanguage: 'pt-br' | 'en';
    }
  | {
      status: 'queued';
      job: Job;
      run: Run;
      payload: GenerateKitPayload;
      /** Old folder whose missing extras are carried over. */
      oldFolder: string | null;
    };

function firstFolder(relativePaths: string[]): string | null {
  for (const relativePath of relativePaths) {
    const folder = String(relativePath ?? '').split('/')[0];
    if (folder) return folder;
  }
  return null;
}

/** Creates the regeneration run (queued) and its `generate-kit` payload. */
export function startRegeneration(
  store: Store,
  jobId: string,
  input: RegenerateInput = {},
): RegeneratePlan {
  const job = store.jobs.get(jobId);
  if (!job) return { status: 'not_found' };

  const latestRun = store.runs.list({ jobId, limit: 1 })[0] ?? null;
  const pasted = String(input.rawText ?? '').trim();
  const snapshot = latestRun?.jobSnapshot ?? null;
  if (!pasted && !snapshot?.content) {
    return {
      status: 'no_source',
      error:
        'Sem texto da vaga para regenerar. Rode um fit-check ou envie rawText.',
    };
  }

  const requiredLanguage =
    job.fit?.languageGate?.required ||
    latestRun?.fit?.languageGate?.required ||
    null;
  const requested =
    input.languagePreference && input.languagePreference !== 'auto'
      ? normalizeLang(input.languagePreference)
      : null;
  if (
    requested &&
    requiredLanguage &&
    normalizeLang(requiredLanguage) !== requested
  ) {
    return {
      status: 'language_conflict',
      error: `A vaga exige currículo em ${
        normalizeLang(requiredLanguage) === 'en' ? 'Inglês' : 'Português (PT-BR)'
      }. Não é permitido alterar o idioma na regeneração.`,
      jobRequiredLanguage: normalizeLang(requiredLanguage),
      providedLanguage: requested,
    };
  }

  const language = requested ?? normalizeLang(requiredLanguage ?? job.language);
  const stack = normalizeStack(input.stack || job.stack || latestRun?.stack);

  const extraQuestions =
    input.extraQuestions !== undefined
      ? String(input.extraQuestions ?? '')
      : String(snapshot?.extraQuestions ?? '');
  const recruiterMessage =
    input.recruiterMessage !== undefined
      ? String(input.recruiterMessage ?? '')
      : String(snapshot?.recruiterMessage ?? '');
  const coverLetterGuidance =
    input.coverLetterGuidance !== undefined
      ? String(input.coverLetterGuidance ?? '').slice(0, 2000)
      : job.coverLetterGuidance;
  const includeCoverInCv =
    input.includeCoverInCv !== undefined
      ? input.includeCoverInCv
      : job.coverInCvRequired
        ? true
        : 'auto';

  const jobSnapshot: JobSnapshot = pasted
    ? {
        title: job.role,
        company: job.company,
        url: job.vacancyUrl || '',
        applyUrl: job.applyUrl || '',
        detectedLanguage: language,
        content: pasted,
        extraQuestions,
        recruiterMessage,
      }
    : { ...snapshot, extraQuestions, recruiterMessage };

  const run = store.runs.create({
    jobId: job.id,
    stage: 'queued',
    url: job.vacancyUrl || latestRun?.url || '',
    stack,
    languagePreference: language,
    detectedLanguage:
      latestRun?.detectedLanguage || jobSnapshot.detectedLanguage || language,
    suggestedLanguage: language,
    hasRawText: Boolean(pasted),
    hasExtraQuestions: Boolean(extraQuestions),
    hasRecruiterMessage: Boolean(recruiterMessage),
    fit: job.fit ?? latestRun?.fit ?? null,
    jobSnapshot,
    coverLetterGuidance: coverLetterGuidance ?? null,
    includeCoverInCv: typeof includeCoverInCv === 'string' ? includeCoverInCv : String(includeCoverInCv),
  });

  const oldFolder = firstFolder(
    store.artifacts.listByJob(job.id).map((artifact) => artifact.relativePath),
  );

  return {
    status: 'queued',
    job,
    run,
    oldFolder,
    payload: {
      language,
      stack,
      fitConfirmed: true,
      extraQuestions,
      recruiterMessage,
      coverLetterGuidance: coverLetterGuidance ?? null,
      artifactGuidance: String(input.guidance ?? '').trim().slice(0, 2000) || null,
      includeCoverInCv,
      artifacts: input.artifacts ?? undefined,
      needsInputRounds: 0,
      regenerateFromFolder: oldFolder,
    },
  };
}
