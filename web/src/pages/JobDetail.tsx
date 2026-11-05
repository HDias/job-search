import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useJob, useUpdateJob } from '../api/hooks';
import { JOB_STATUSES, type JobStatus } from '../api/types';
import { ArtifactList } from '../components/ArtifactList';
import { FitPanel } from '../components/FitPanel';
import { RunList } from '../components/RunList';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage';
import { STATUS_LABELS, formatDate } from '../lib/format';
import { hasActiveRuns, pendingConfirmation } from '../lib/runs';

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobQuery = useJob(id);
  const updateJob = useUpdateJob();

  if (jobQuery.isLoading) {
    return <LoadingState label="Carregando vaga…" />;
  }

  if (jobQuery.isError) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    if (notFound) {
      return (
        <EmptyState
          title="Vaga não encontrada"
          description="O registro pode ter sido removido."
          action={
            <Link className="button" to="/">
              Voltar ao dashboard
            </Link>
          }
        />
      );
    }

    return (
      <ErrorState
        message={jobQuery.error instanceof Error ? jobQuery.error.message : 'Erro desconhecido'}
        onRetry={() => void jobQuery.refetch()}
      />
    );
  }

  if (!jobQuery.data) return null;

  const { job, runs, artifacts } = jobQuery.data;
  const live = hasActiveRuns(runs);
  const pending = pendingConfirmation(runs);

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Voltar ao dashboard
      </Link>

      <header className="detail-header">
        <div>
          <p className="eyebrow">{job.company}</p>
          <h1>{job.role}</h1>
          <div className="detail-meta">
            <StatusBadge status={job.status} />
            <span className="chip">stack: {job.stack}</span>
            <span className="chip">idioma: {job.language}</span>
            <span className="muted">aplicada em {formatDate(job.appliedAt)}</span>
            {job.channel ? <span className="muted">canal: {job.channel}</span> : null}
            {live ? <span className="chip chip-live">atualizando…</span> : null}
          </div>
        </div>

        <div className="detail-actions">
          <label className="field">
            <span>Status da candidatura</span>
            <select
              value={job.status}
              disabled={updateJob.isPending}
              onChange={(event) =>
                updateJob.mutate({
                  id: job.id,
                  patch: { status: event.target.value as JobStatus },
                })
              }
            >
              {JOB_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <div className="link-row">
            {job.vacancyUrl ? (
              <a className="button ghost" href={job.vacancyUrl} target="_blank" rel="noreferrer">
                Ver vaga
              </a>
            ) : null}
            {job.applyUrl && job.applyUrl !== job.vacancyUrl ? (
              <a className="button ghost" href={job.applyUrl} target="_blank" rel="noreferrer">
                Abrir candidatura
              </a>
            ) : null}
          </div>

          {updateJob.isError ? (
            <p className="inline-error" role="alert">
              {updateJob.error instanceof Error
                ? updateJob.error.message
                : 'Não foi possível atualizar o status.'}
            </p>
          ) : null}
          {updateJob.isSuccess ? <p className="inline-ok">Status atualizado.</p> : null}
        </div>
      </header>

      {pending ? (
        <div className="notice" role="status">
          <strong>
            Aguardando confirmação de {pending === 'language' ? 'idioma' : 'fit'}
          </strong>
          <p>
            O pipeline parou neste checkpoint. A retomada ainda é feita pela interface do v1; o
            v2 acompanha o estado e atualiza a página a cada 4 segundos.
          </p>
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="detail-main">
          <FitPanel fit={job.fit} />
          <RunList runs={runs} />
        </div>

        <aside className="detail-side">
          <ArtifactList jobId={job.id} artifacts={artifacts} />

          <section className="panel">
            <div className="panel-header">
              <h2>Resumo</h2>
            </div>
            <dl className="summary">
              <div>
                <dt>Empresa</dt>
                <dd>{job.company}</dd>
              </div>
              <div>
                <dt>Stack</dt>
                <dd>{job.stack}</dd>
              </div>
              <div>
                <dt>Idioma</dt>
                <dd>
                  {job.language}
                  {job.languageConfirmation ? ` (${job.languageConfirmation})` : ''}
                </dd>
              </div>
              <div>
                <dt>Canal</dt>
                <dd>{job.channel ?? '—'}</dd>
              </div>
              <div>
                <dt>Criada em</dt>
                <dd>{formatDate(job.createdAt)}</dd>
              </div>
              <div>
                <dt>Atualizada em</dt>
                <dd>{formatDate(job.updatedAt)}</dd>
              </div>
              <div>
                <dt>Perguntas</dt>
                <dd>{job.hasQuestions ? 'sim' : 'não'}</dd>
              </div>
              <div>
                <dt>Recrutador</dt>
                <dd>{job.hasRecruiterMessage ? 'sim' : 'não'}</dd>
              </div>
            </dl>

            {job.appliedEmails.length > 0 ? (
              <div className="summary-block">
                <h3>E-mails usados</h3>
                <ul className="plain-list">
                  {job.appliedEmails.map((email) => (
                    <li key={email}>{email}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {job.coverLetterGuidance ? (
              <div className="summary-block">
                <h3>Orientação da carta</h3>
                <p className="muted">{job.coverLetterGuidance}</p>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
