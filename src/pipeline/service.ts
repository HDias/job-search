import fs from 'node:fs';
import path from 'node:path';
import { createLlmClient, type LlmClient } from './llm/client.js';
import { checkJobFit, type FitCheckDeps, type FitCheckResult } from './kit/fit.js';
import { evaluateFit, type EvaluateFitInput, type EvaluateFitResult } from './fit/evaluate.js';
import { createSkillLoader } from './skills/loader.js';
import {
  createRunQueue,
  type FitCheckPayload,
  type GenerateKitPayload,
  type RunQueue,
} from './queue.js';
import { createFitCheckRunner } from './runs/fit-check.js';
import { createGenerateKitRunner } from './runs/generate-kit.js';
import {
  assistApplication,
  type ApplyBrowser,
  type CandidateData,
  type FilledField,
  type SubmitButtonInfo,
} from './apply/assistant.js';
import {
  QUESTIONS_FILE,
  scrapeApplicationQuestions,
  type QuestionsResult,
} from './apply/questions.js';
import { candidateFromStore } from './candidate-data.js';
import type { PdfRenderer } from './kit/artifacts.js';
import type { ScrapeBrowser, ScrapeDeps } from './scrape/job.js';
import type { Store } from '../repositories/types.js';

/**
 * Wires the pipeline to the store. HTTP routes only talk to this service;
 * tests can inject `llm`, `scrape` and `browser` to avoid network/Chromium.
 */

export interface PipelineServiceDeps {
  store: Store;
  skillsDir: string;
  llm?: LlmClient;
  scrape?: FitCheckDeps['scrape'];
  scrapeDeps?: ScrapeDeps;
  /** Shared Chromium instance (queue worker). */
  browser?: ScrapeBrowser;
  /** Where kit folders are written (defaults to the v1 `applications/`). */
  applicationsDir?: string;
  /** Injected in tests so PDF rendering never launches Chromium. */
  renderPdf?: PdfRenderer;
  /** Injected in tests so the prefill/questions dry-run never launches Chromium. */
  applyBrowser?: ApplyBrowser;
}

export interface PipelineService {
  queue: RunQueue;
  evaluateFit(input: EvaluateFitInput): EvaluateFitResult;
  enqueueFitCheck(runId: string, payload: FitCheckPayload): void;
  enqueueGenerateKit(runId: string, payload: GenerateKitPayload): void;
  checkFit(input: FitCheckPayload): Promise<FitCheckResult>;
  prefill(jobId: string, input: PrefillInput): Promise<PrefillOutcome>;
  scrapeQuestions(
    jobId: string,
    input: { applyUrl?: string },
  ): Promise<QuestionsOutcome>;
}

/** v1 prefill response, minus the absolute paths. */
export interface PrefillSummary {
  status: string;
  filledFields: FilledField[];
  resumeAttached: boolean;
  submitButtonDetected: SubmitButtonInfo;
  screenshotUrl: string;
  reportUrl: string;
  notice: string;
}

export interface PrefillInput {
  applyUrl?: string;
  candidateData?: Record<string, unknown>;
  headed?: boolean;
}

export type PrefillOutcome =
  | { status: 'not_found' }
  | { status: 'no_url' }
  | { status: 'no_pdf' }
  | { status: 'ok'; prefill: PrefillSummary };

export type QuestionsOutcome =
  | { status: 'not_found' }
  | { status: 'no_url' }
  | { status: 'no_folder' }
  | { status: 'ok'; result: QuestionsResult; questionsUrl: string };

export function createPipelineService(
  deps: PipelineServiceDeps,
): PipelineService {
  const { store } = deps;
  const loader = createSkillLoader(deps.skillsDir);
  const llm =
    deps.llm ??
    createLlmClient({
      settings: store.settings,
    });

  const checkFit = (input: FitCheckPayload): Promise<FitCheckResult> =>
    checkJobFit(
      {
        store,
        loader,
        llm,
        scrape: deps.scrape,
        scrapeDeps: {
          browser: deps.browser,
          ...deps.scrapeDeps,
        },
      },
      input,
    );

  const queue = createRunQueue(
    async (task) => {
      if (task.kind === 'fit-check') {
        const runner = createFitCheckRunner({ store, checkFit });
        await runner(task);
        return;
      }
      if (task.kind === 'generate-kit') {
        const runner = createGenerateKitRunner({
          store,
          llm,
          loader,
          applicationsDir:
            deps.applicationsDir ??
            process.env.APPLICATIONS_DIR ??
            path.resolve('..', 'job-search', 'applications'),
          renderPdf: deps.renderPdf,
        });
        await runner(task);
        return;
      }
      throw new Error(`Tarefa de pipeline não suportada: ${task.kind}`);
    },
    {
      onError: (task, error) => {
        // Safety net: the runner already records failures, but a crash before
        // it must never leave a queued run hanging forever.
        const run = store.runs.get(task.runId);
        if (!run || run.stage === 'failed') return;
        store.runs.update(run.id, {
          stage: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      },
    },
  );

  // One Chromium can serve the scraper and the dry-run; tests inject either.
  const applyBrowser =
    deps.applyBrowser ?? (deps.browser as unknown as ApplyBrowser | undefined);

  const applicationsDir =
    deps.applicationsDir ??
    process.env.APPLICATIONS_DIR ??
    path.resolve('..', 'job-search', 'applications');

  /** Relative folder of the job's kit (from its CV artifact), v1 layout. */
  const jobFolder = (jobId: string): { rel: string; abs: string } | null => {
    const artifacts = store.artifacts.listByJob(jobId);
    const cv = artifacts.find((artifact) => artifact.kind === 'cv_pdf');
    if (!cv) return null;
    const rel = path.posix.dirname(cv.relativePath);
    if (!rel || rel === '.') return null;
    return { rel, abs: path.join(applicationsDir, ...rel.split('/')) };
  };

  const publicUrl = (relative: string): string =>
    `/applications/${relative.split(path.sep).join('/')}`;

  return {
    queue,
    evaluateFit: (input) => evaluateFit(store, input),
    enqueueFitCheck: (runId, payload) =>
      queue.enqueue({ kind: 'fit-check', runId, payload }),
    enqueueGenerateKit: (runId, payload) =>
      queue.enqueue({ kind: 'generate-kit', runId, payload }),
    checkFit,

    async prefill(jobId, input) {
      const job = store.jobs.get(jobId);
      if (!job) return { status: 'not_found' };

      const url = String(input.applyUrl ?? job.applyUrl ?? job.vacancyUrl ?? '');
      if (!url.startsWith('http')) return { status: 'no_url' };

      const folder = jobFolder(job.id);
      const cv = store.artifacts
        .listByJob(job.id)
        .find((artifact) => artifact.kind === 'cv_pdf');
      const resumePath = cv
        ? path.join(applicationsDir, ...cv.relativePath.split('/'))
        : null;
      if (!folder || !resumePath || !fs.existsSync(resumePath)) {
        return { status: 'no_pdf' };
      }

      const candidate: CandidateData = {
        ...candidateFromStore(store),
        ...(input.candidateData ?? {}),
      };
      store.settings.set('candidate_form', {
        ...candidate,
        updatedAt: new Date().toISOString(),
      });

      const report = await assistApplication({
        url,
        candidate,
        resumePath,
        outputDir: folder.abs,
        headed: input.headed,
        browser: applyBrowser,
      });

      return {
        status: 'ok',
        prefill: {
          status: report.status,
          filledFields: report.filledFields,
          resumeAttached: report.resumeAttached,
          submitButtonDetected: report.submitButtonDetected,
          screenshotUrl: publicUrl(
            path.join(folder.rel.split('/').join(path.sep), path.basename(report.screenshotPath)),
          ),
          reportUrl: publicUrl(
            path.join(folder.rel.split('/').join(path.sep), path.basename(report.reportPath)),
          ),
          notice: report.notice,
        },
      };
    },

    async scrapeQuestions(jobId, input) {
      const job = store.jobs.get(jobId);
      if (!job) return { status: 'not_found' };

      const url = String(input.applyUrl ?? job.applyUrl ?? job.vacancyUrl ?? '');
      if (!url.startsWith('http')) return { status: 'no_url' };

      const folder = jobFolder(job.id);
      if (!folder) return { status: 'no_folder' };

      const result = await scrapeApplicationQuestions({
        url,
        outputDir: folder.abs,
        browser: applyBrowser,
      });

      return {
        status: 'ok',
        result,
        questionsUrl: publicUrl(
          path.join(
            folder.rel.split('/').join(path.sep),
            QUESTIONS_FILE,
          ),
        ),
      };
    },
  };
}

/** Best-effort existence check used by the server to warn about skill assets. */
export function hasSkillAssets(skillsDir: string): boolean {
  return fs.existsSync(skillsDir);
}
