import type { Job, Run } from '../api/types';
import { useFitCheck, useGenerateKit } from '../api/hooks';

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

  const snapshot = run?.jobSnapshot ?? run?.job ?? null;
  const canFitCheck = Boolean(job.vacancyUrl || snapshot?.content || snapshot?.url);

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
    generateKit.mutate({ processId: run.id });
  }

  const error = fitCheck.error ?? generateKit.error;

  return (
    <div className="pipeline-actions">
      <div className="link-row">
        <button
          type="button"
          className="button ghost"
          disabled={!canFitCheck || fitCheck.isPending}
          onClick={startFitCheck}
        >
          {fitCheck.isPending ? 'Enfileirando…' : 'Rodar fit-check'}
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={!run || generateKit.isPending}
          onClick={startGeneration}
        >
          {generateKit.isPending ? 'Enfileirando…' : 'Gerar kit'}
        </button>
      </div>

      {!canFitCheck && !run ? (
        <p className="muted">
          Sem link ou texto da vaga e sem processamento anterior: rode o fit-check
          pela API para começar.
        </p>
      ) : null}

      {fitCheck.isSuccess || generateKit.isSuccess ? (
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
