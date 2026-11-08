import type { FitCheckResult } from '../kit/fit.js';
import type { FitCheckPayload, QueueTask } from '../queue.js';
import type { Store } from '../../repositories/types.js';

/** Executes one queued fit-check and persists its checkpoint on `runs`. */
export function createFitCheckRunner(deps: {
  store: Store;
  checkFit: (input: FitCheckPayload) => Promise<FitCheckResult>;
}): (task: QueueTask) => Promise<void> {
  const { store } = deps;

  return async (task) => {
    const run = store.runs.get(task.runId);
    if (!run) return;
    const payload = (task.payload ?? {}) as FitCheckPayload;

    try {
      const willScrape =
        Boolean(payload.url?.startsWith('http')) &&
        !run.jobSnapshot?.content;
      if (willScrape) {
        store.runs.update(run.id, { stage: 'scraping', error: null });
      } else if (run.error) {
        store.runs.update(run.id, { error: null });
      }

      const result = await deps.checkFit(payload);

      if (result.needsManualContent) {
        store.runs.update(run.id, {
          stage: 'scrape-thin',
          job: result.job,
          jobSnapshot: result.jobSnapshot,
          detectedLanguage: result.detectedLanguage,
          suggestedLanguage: result.suggestedLanguage,
          needsLanguageConfirmation: true,
          needsFitConfirmation: false,
          eligibilityBlocked: false,
          fit: null,
          error: null,
        });
        return;
      }

      store.runs.update(run.id, {
        stage: 'fit-checked',
        job: result.job,
        jobSnapshot: result.jobSnapshot,
        detectedLanguage: result.detectedLanguage,
        suggestedLanguage: result.suggestedLanguage,
        needsLanguageConfirmation: result.needsLanguageConfirmation,
        needsFitConfirmation: result.needsFitConfirmation,
        eligibilityBlocked: result.eligibilityBlocked,
        fit: result.fit,
        error: null,
      });
    } catch (error) {
      store.runs.update(run.id, {
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
