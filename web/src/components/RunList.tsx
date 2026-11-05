import type { Run } from '../api/types';
import { STAGE_LABELS, formatDateTime, formatFit } from '../lib/format';

function Flag({ active, children }: { active: boolean; children: string }) {
  if (!active) return null;
  return <span className="chip">{children}</span>;
}

export function RunList({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Processamentos</h2>
        </div>
        <p className="muted">Nenhum checkpoint registrado.</p>
      </section>
    );
  }

  const ordered = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Processamentos</h2>
        <span className="muted">{runs.length}</span>
      </div>

      <ol className="run-list">
        {ordered.map((run) => {
          const snapshot = run.jobSnapshot ?? run.job;
          return (
            <li className="run-card" key={run.id}>
              <div className="run-head">
                <span className={`stage stage-${run.stage.replace(/[^a-z-]/g, '')}`}>
                  {STAGE_LABELS[run.stage] ?? run.stage}
                </span>
                <span className="muted">{formatDateTime(run.createdAt)}</span>
              </div>

              <div className="run-meta">
                {run.stack ? <span className="chip">{run.stack}</span> : null}
                {run.languagePreference ? (
                  <span className="chip">idioma: {run.languagePreference}</span>
                ) : null}
                {typeof run.fit?.rating === 'number' ? (
                  <span className="chip">fit {formatFit(run.fit.rating)}</span>
                ) : null}
                <Flag active={run.hasRawText}>texto bruto</Flag>
                <Flag active={run.hasExtraQuestions}>perguntas</Flag>
                <Flag active={run.hasRecruiterMessage}>recrutador</Flag>
                <Flag active={run.eligibilityBlocked}>bloqueado</Flag>
              </div>

              {run.url ? (
                <a className="run-url" href={run.url} target="_blank" rel="noreferrer">
                  {run.url}
                </a>
              ) : null}

              {run.error ? <p className="run-error">{run.error}</p> : null}

              {snapshot?.content || run.jobSnapshot?.extraQuestions ? (
                <details className="run-details">
                  <summary>Ver snapshot da vaga</summary>
                  {run.jobSnapshot?.extraQuestions ? (
                    <div>
                      <h4>Perguntas extras</h4>
                      <pre>{run.jobSnapshot.extraQuestions}</pre>
                    </div>
                  ) : null}
                  {snapshot?.content ? (
                    <div>
                      <h4>Descrição</h4>
                      <pre>{snapshot.content}</pre>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
