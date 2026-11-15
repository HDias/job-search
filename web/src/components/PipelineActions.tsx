import type { Job, Run } from '../api/types';
import {
  useFitCheck,
  useGenerateKit,
  useRegenerateKit,
} from '../api/hooks';


/** Stages that still own the slot: nothing else can be enqueued meanwhile. */
const PENDING_STAGES = new Set([
  'queued',
  'scraping',
  'scrape-thin',
  'generating',
  'needs_input',
]);

interface PipelineActionsProps {
  job: Job;
  /** Latest run for the job; the pipeline entrypoints reuse it when present. */
  run: Run | null;
}

/**
 * Discrete entrypoint to the async pipeline (D2): both actions answer
 * `202 { runId }` and the job detail keeps polling every 4 s, so there is no
 * local progress state here.
 */
export function PipelineActions({ job, run }: PipelineActionsProps) {
  const fitCheck = useFitCheck(job.id);
  const generateKit = useGenerateKit(job.id);
  const regenerateKit = useRegenerateKit(job.id);

  const snapshot = run?.jobSnapshot ?? run?.job ?? null;
  // The two steps are sequential: nothing else runs while the current one is
  // queued, scraping, generating or waiting on a human answer.
  const pending = Boolean(run && PENDING_STAGES.has(run.stage));
  const gatesOpen = Boolean(
    run && (run.needsLanguageConfirmation || run.needsFitConfirmation),
  );
  const busy = pending || gatesOpen;
  const canFitCheck = Boolean(job.vacancyUrl || snapshot?.content || snapshot?.url);
  const canGenerate = Boolean(run && run.stage === 'fit-checked' && !busy);
  // A finished application keeps its kit: the button rebuilds it from the
  // saved snapshot instead of forcing a new fit-check.
  const kitDone = Boolean(
    run && (run.stage === 'done' || (run.stage === 'failed' && run.jobId)),
  );
  const canRegenerate = kitDone && !busy;
  // Enqueue is fast; the spinner must stay while the kit is actually generated.
  const generatingKit =
    generateKit.isPending ||
    regenerateKit.isPending ||
    run?.stage === 'generating';

  function startFitCheck() {
    fitCheck.mutate({
      url: job.vacancyUrl ?? undefined,
      processId: run?.id,
      stack: job.stack,
      languagePreference: job.language,
      jobSnapshot: job.vacancyUrl ? undefined : (snapshot ?? undefined),
    });
  }

  function startGeneration() {
    if (!run) return;
    if (kitDone) {
      regenerateKit.mutate({});
      return;
    }
    generateKit.mutate({ processId: run.id });
  }

  const error = fitCheck.error ?? generateKit.error ?? regenerateKit.error;

  return (
    <div className="pipeline-actions">
      <div className="link-row">
        <button
          type="button"
          className="button ghost"
          disabled={!canFitCheck || busy || fitCheck.isPending}
          onClick={startFitCheck}
        >
          {fitCheck.isPending ? 'Enfileirando…' : 'Rodar fit-check'}
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={
            kitDone
              ? !canRegenerate || regenerateKit.isPending
              : !canGenerate || generateKit.isPending
          }
          onClick={startGeneration}
        >
          {generatingKit ? (
            <>
              <span className="spinner" aria-hidden="true" />
              {run?.stage === 'generating' ? 'Gerando kit…' : 'Enfileirando…'}
            </>
          ) : kitDone ? (
            'Regerar kit'
          ) : (
            'Gerar kit'
          )}
        </button>
      </div>

      {pending &&
      !fitCheck.isPending &&
      !generateKit.isPending &&
      !regenerateKit.isPending ? (
        <p className="muted">
          Aguarde o processamento atual antes de rodar outra etapa.
        </p>
      ) : null}

      {!canFitCheck && !run ? (
        <p className="muted">
          Sem link ou texto da vaga e sem processamento anterior: rode o fit-check
          pela API para começar.
        </p>
      ) : null}

      {fitCheck.isSuccess ||
      generateKit.isSuccess ||
      regenerateKit.isSuccess ? (
        <p className="inline-ok">Processamento enfileirado.</p>
      ) : null}

      {error ? (
        <p className="inline-error" role="alert">
          {error instanceof Error ? error.message : 'Não foi possível enfileirar.'}
        </p>
      ) : null}
    </div>
  );
}
