import { useDeleteRun } from '../api/hooks';
import type { Run } from '../api/types';
import { STAGE_LABELS, fitTone, formatDate, formatFit } from '../lib/format';

interface InterruptedRunsProps {
  runs: Run[];
  onContinue: (run: Run) => void;
}

/**
 * v1 parity: unfinished checkpoints stay on the dashboard so the user resumes
 * from the saved fit-check instead of scraping and analysing the job again.
 */
export function InterruptedRuns({ runs, onContinue }: InterruptedRunsProps) {
  const remove = useDeleteRun();

  if (runs.length === 0) return null;

  return (
    <section
      className="panel interrupted-runs"
      aria-label="Processos interrompidos"
    >
      <div className="panel-header">
        <h2>Processos interrompidos</h2>
        <span className="muted">continuar de onde parou (sem re-raspar)</span>
      </div>

      <ul className="process-list">
        {runs.map((run) => {
          const job = run.jobSnapshot ?? run.job;
          const company = job?.company || 'Vaga';
          const role = job?.title || '';
          const stage = STAGE_LABELS[run.stage] ?? run.stage;

          return (
            <li key={run.id} className="process-row">
              <div className="process-main">
                <strong>{company}</strong>
                {role ? <span>{role}</span> : null}
                <span className="process-stage">{stage}</span>
                {run.fit ? (
                  <span className={`fit-pill tone-${fitTone(run.fit.rating)}`}>
                    {formatFit(run.fit.rating)}
                  </span>
                ) : null}
                <span className="muted">{formatDate(run.updatedAt)}</span>
                {run.error ? (
                  <span className="process-error muted" title={run.error}>
                    {run.error.slice(0, 80)}
                  </span>
                ) : null}
              </div>

              <div className="link-row">
                <button
                  type="button"
                  className="button"
                  onClick={() => onContinue(run)}
                >
                  ▶ Continuar
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm('Descartar este processo interrompido?')) {
                      return;
                    }
                    remove.mutate(run.id);
                  }}
                >
                  Descartar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {remove.error ? (
        <p className="inline-error" role="alert">
          {remove.error instanceof Error
            ? remove.error.message
            : 'Não foi possível descartar o processo.'}
        </p>
      ) : null}
    </section>
  );
}
