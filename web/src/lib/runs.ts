import type { Run } from '../api/types';

const FINISHED_STAGES = new Set(['done', 'failed']);

/** Um run está ativo enquanto não terminou ou enquanto espera confirmação. */
export function isRunActive(run: Run): boolean {
  return (
    !FINISHED_STAGES.has(run.stage) ||
    run.needsLanguageConfirmation ||
    run.needsFitConfirmation
  );
}

export function hasActiveRuns(runs: Run[] | undefined): boolean {
  return Boolean(runs?.some(isRunActive));
}

export type PendingConfirmation = 'language' | 'fit' | null;

/** Qual confirmação humana o checkpoint atual está esperando, se alguma. */
export function pendingConfirmation(
  runs: Run[] | undefined,
): PendingConfirmation {
  if (!runs) return null;
  if (runs.some((run) => run.needsLanguageConfirmation)) return 'language';
  if (runs.some((run) => run.needsFitConfirmation)) return 'fit';
  return null;
}
