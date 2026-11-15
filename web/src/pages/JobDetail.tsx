import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useJob, useRespondToRun, useUpdateJob } from '../api/hooks';
import { JOB_STATUSES, type JobStatus } from '../api/types';
import { ArtifactList } from '../components/ArtifactList';
import { ApplyActions } from '../components/ApplyActions';
import { ApplyConfirm } from '../components/ApplyConfirm';
import { ChatPanel } from '../components/ChatPanel';
import { CheckpointPanel } from '../components/CheckpointPanel';
import { FitPanel } from '../components/FitPanel';
import { JobChannelEditor } from '../components/JobChannelEditor';
import { PipelineActions } from '../components/PipelineActions';
import { RunList } from '../components/RunList';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage';
import { STATUS_LABELS, formatDate } from '../lib/format';
import { hasActiveRuns, pendingConfirmation, pendingQuestion } from '../lib/runs';

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobQuery = useJob(id);
  const updateJob = useUpdateJob();
  const respond = useRespondToRun(id ?? null);

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
  const waiting = pendingQuestion(runs);
  const latestRun = runs[0] ?? null;

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

        <label className="field detail-status">
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
      </header>

      {updateJob.isError ? (
        <p className="inline-error" role="alert">
          {updateJob.error instanceof Error
            ? updateJob.error.message
            : 'Não foi possível atualizar o status.'}
        </p>
      ) : null}
      {updateJob.isSuccess ? (
        <p className="inline-ok">Status atualizado.</p>
      ) : null}

      <section className="panel next-steps" aria-label="Próximos passos">
        <div className="panel-header">
          <h2>Próximos passos</h2>
          <span className="muted">siga na ordem; cada etapa libera a seguinte</span>
        </div>

        <div className="steps-grid">
          <div className="step">
            <span className="step-number" aria-hidden="true">
              1
            </span>
            <div className="step-body">
              <h3>Analise e prepare o material</h3>
              <p className="muted">
                Rode o fit-check para ver a compatibilidade da vaga e, se fizer
                sentido, gere o currículo, a carta e a mensagem ao recrutador.
              </p>
              <PipelineActions job={job} run={latestRun} />
            </div>
          </div>

          <div className="step">
            <span className="step-number" aria-hidden="true">
              2
            </span>
            <div className="step-body">
              <h3>Candidate-se no site</h3>
              <p className="muted">
                Abra o anúncio para enviar sua candidatura. Se quiser ajuda, o
                app pré-preenche o formulário — nada é enviado automaticamente.
              </p>
              <div className="link-row">
                {job.vacancyUrl ? (
                  <a
                    className="button ghost"
                    href={job.vacancyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver vaga
                  </a>
                ) : null}
                {job.applyUrl && job.applyUrl !== job.vacancyUrl ? (
                  <a
                    className="button ghost"
                    href={job.applyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir candidatura
                  </a>
                ) : null}
              </div>
              <ApplyActions
                job={job}
                hasKit={artifacts.some((artifact) => artifact.kind === 'cv_pdf')}
              />
            </div>
          </div>

          <div className="step">
            <span className="step-number" aria-hidden="true">
              3
            </span>
            <div className="step-body">
              <h3>Registre a candidatura</h3>
              <p className="muted">
                Depois de enviar pelo site, marque aqui para acompanhar o status
                no dashboard.
              </p>
              <ApplyConfirm job={job} />
            </div>
          </div>
        </div>
      </section>

      {waiting ? (
        <CheckpointPanel
          question={waiting.question}
          rounds={waiting.run.needsInputRounds}
          pending={respond.isPending}
          error={respond.error instanceof Error ? respond.error.message : null}
          onRespond={(input) =>
            respond.mutate({ runId: waiting.run.id, input })
          }
        />
      ) : null}

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
          <ChatPanel job={job} />
          <RunList runs={runs} />
        </div>

        <aside className="detail-side">
          <ArtifactList
            jobId={job.id}
            artifacts={artifacts}
            busy={live}
          />

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
              <div className="summary-wide">
                <dt>Canal</dt>
                <dd>
                  <JobChannelEditor job={job} />
                </dd>
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
