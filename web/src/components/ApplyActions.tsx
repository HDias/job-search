import type { Job } from '../api/types';
import { usePrefill, useQuestions } from '../api/hooks';

interface ApplyActionsProps {
  job: Job;
  /** A kit folder (cv_pdf artifact) is required by both endpoints. */
  hasKit: boolean;
}

/**
 * Prefill dry-run and application-question extraction (D8). Both endpoints
 * answer synchronously and never submit the form; the UI only displays the
 * generated report and question list.
 */
export function ApplyActions({ job, hasKit }: ApplyActionsProps) {
  const prefill = usePrefill(job.id);
  const questions = useQuestions(job.id);

  const hasUrl = Boolean(job.applyUrl || job.vacancyUrl);
  const blocked = !hasUrl || !hasKit;
  const error = prefill.error ?? questions.error;

  return (
    <div className="apply-actions">
      <div className="link-row">
        <button
          type="button"
          className="button ghost"
          disabled={blocked || prefill.isPending}
          onClick={() => prefill.mutate({ applyUrl: job.applyUrl ?? undefined })}
        >
          {prefill.isPending ? 'Preenchendo…' : 'Pré-preencher formulário'}
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={blocked || questions.isPending}
          onClick={() => questions.mutate({ applyUrl: job.applyUrl ?? undefined })}
        >
          {questions.isPending ? 'Extraindo…' : 'Extrair perguntas'}
        </button>
      </div>

      {blocked ? (
        <p className="muted">
          Informe a URL de candidatura e o kit (PDF do currículo) para usar o
          dry-run e a extração de perguntas.
        </p>
      ) : null}

      {prefill.isSuccess ? (
        <div className="result-block">
          <p className="inline-ok">Dry-run: {prefill.data.prefill.status}</p>
          <p>{prefill.data.prefill.filledFields.length} campos preenchidos</p>
          <p>
            Currículo anexado: {prefill.data.prefill.resumeAttached ? 'sim' : 'não'}
          </p>
          <div className="link-row">
            <a
              className="button ghost"
              href={prefill.data.prefill.screenshotUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ver screenshot
            </a>
            <a
              className="button ghost"
              href={prefill.data.prefill.reportUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ver relatório
            </a>
          </div>
          <p className="muted">{prefill.data.prefill.notice}</p>
        </div>
      ) : null}

      {questions.isSuccess ? (
        <div className="result-block">
          <p className="inline-ok">Plataforma: {questions.data.platform}</p>
          <p>{questions.data.questions.length} perguntas extraídas</p>
          <div className="link-row">
            <a
              className="button ghost"
              href={questions.data.questionsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ver perguntas
            </a>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="inline-error" role="alert">
          {error instanceof Error ? error.message : 'Não foi possível concluir a ação.'}
        </p>
      ) : null}
    </div>
  );
}
