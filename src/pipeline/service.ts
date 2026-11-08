import fs from 'node:fs';
import { createLlmClient, type LlmClient } from './llm/client.js';
import { checkJobFit, type FitCheckDeps, type FitCheckResult } from './kit/fit.js';
import { evaluateFit, type EvaluateFitInput, type EvaluateFitResult } from './fit/evaluate.js';
import { createSkillLoader } from './skills/loader.js';
import { createRunQueue, type FitCheckPayload, type RunQueue } from './queue.js';
import { createFitCheckRunner } from './runs/fit-check.js';
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
}

export interface PipelineService {
  queue: RunQueue;
  evaluateFit(input: EvaluateFitInput): EvaluateFitResult;
  enqueueFitCheck(runId: string, payload: FitCheckPayload): void;
  checkFit(input: FitCheckPayload): Promise<FitCheckResult>;
}

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

  return {
    queue,
    evaluateFit: (input) => evaluateFit(store, input),
    enqueueFitCheck: (runId, payload) =>
      queue.enqueue({ kind: 'fit-check', runId, payload }),
    checkFit,
  };
}

/** Best-effort existence check used by the server to warn about skill assets. */
export function hasSkillAssets(skillsDir: string): boolean {
  return fs.existsSync(skillsDir);
}
