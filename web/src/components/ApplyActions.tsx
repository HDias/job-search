import type { Job } from '../api/types';
import { useQuestions } from '../api/hooks';

interface ApplyActionsProps {
  job: Job;
  /** A kit folder (cv_pdf artifact) is required by the endpoint. */
  hasKit: boolean;
}

/**
 * Application-question extraction (D8). The endpoint answers synchronously and
 * never submits the form; the UI only displays the generated question list.
 */
export function ApplyActions({ job, hasKit }: ApplyActionsProps) {
  const questions = useQuestions(job.id);

  const hasUrl = Boolean(job.applyUrl || job.vacancyUrl);
  const blocked = !hasUrl || !hasKit;

  return (
    <div className="apply-actions">
      <div className="link-row">
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
          Informe a URL de candidatura e o kit (PDF do currículo) para extrair
          as perguntas.
        </p>
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

      {questions.error ? (
        <p className="inline-error" role="alert">
          {questions.error instanceof Error
            ? questions.error.message
            : 'Não foi possível extrair as perguntas.'}
        </p>
      ) : null}
    </div>
  );
}
