import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useFitCheck,
  useGenerateKit,
  useRespondToRun,
  useRun,
} from '../api/hooks';
import { CheckpointPanel } from './CheckpointPanel';
import { STAGE_LABELS, formatFit } from '../lib/format';

interface NewJobModalProps {
  open: boolean;
  onClose: () => void;
}

const LANGUAGES = [
  ['auto', 'Automático (detectar do anúncio + confirmar)'],
  ['pt-br', 'Português (PT-BR)'],
  ['en', 'Inglês (English)'],
] as const;

/**
 * "Nova vaga com IA" (v1 parity): runs the fit-check without a job row, shows
 * the checkpoint and only creates the job when the kit is generated, which is
 * where the async pipeline already owns the `jobs` insert.
 */
export function NewJobModal({ open, onClose }: NewJobModalProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [withoutLink, setWithoutLink] = useState(false);
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [extraQuestions, setExtraQuestions] = useState('');
  const [recruiterMessage, setRecruiterMessage] = useState('');
  const [coverLetterGuidance, setCoverLetterGuidance] = useState('');
  const [languagePreference, setLanguagePreference] =
    useState<(typeof LANGUAGES)[number][0]>('auto');
  const [stack, setStack] = useState('ruby');
  const [language, setLanguage] = useState<'pt-br' | 'en'>('pt-br');
  const [fitConfirmed, setFitConfirmed] = useState(false);

  const fitCheck = useFitCheck();
  const generateKit = useGenerateKit();
  const respond = useRespondToRun(null);
  const runQuery = useRun(runId);
  const run = runQuery.data ?? null;

  function reset() {
    setRunId(null);
    setWithoutLink(false);
    setUrl('');
    setRawText('');
    setExtraQuestions('');
    setRecruiterMessage('');
    setCoverLetterGuidance('');
    setLanguagePreference('auto');
    setStack('ruby');
    setFitConfirmed(false);
  }

  function close() {
    reset();
    onClose();
  }

  function startFitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    fitCheck.mutate(
      {
        url: withoutLink ? undefined : url.trim(),
        rawText: withoutLink ? rawText.trim() : undefined,
        extraQuestions: extraQuestions.trim() || undefined,
        recruiterMessage: recruiterMessage.trim() || undefined,
        languagePreference,
        stack,
      },
      {
        onSuccess: (data) => {
          setRunId(data.runId);
          setLanguage(
            (languagePreference === 'auto' ? 'pt-br' : languagePreference) as
              | 'pt-br'
              | 'en',
          );
        },
      },
    );
  }

  function retryWithPastedText() {
    if (!run) return;
    fitCheck.mutate({
      processId: run.id,
      url: run.url ?? undefined,
      rawText: rawText.trim(),
      extraQuestions: extraQuestions.trim() || undefined,
      recruiterMessage: recruiterMessage.trim() || undefined,
      languagePreference,
      stack,
    });
  }

  function generate() {
    if (!run) return;
    generateKit.mutate({
      processId: run.id,
      language,
      stack,
      fitConfirmed: true,
      extraQuestions: extraQuestions.trim() || undefined,
      recruiterMessage: recruiterMessage.trim() || undefined,
      coverLetterGuidance: coverLetterGuidance.trim() || undefined,
    });
  }

  if (!open) return null;

  const needsFitConfirm = Boolean(
    run && (run.needsFitConfirmation || run.eligibilityBlocked),
  );
  const canGenerate = Boolean(
    run &&
      (run.stage === 'fit-checked' || run.stage === 'failed') &&
      (!needsFitConfirm || fitConfirmed),
  );
  const busyStages = new Set(['queued', 'scraping', 'generating']);
  const error =
    fitCheck.error ?? generateKit.error ?? respond.error ?? runQuery.error;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-job-title"
      >
        <div className="modal-header">
          <h2 id="new-job-title">Nova vaga com IA</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Fechar"
            onClick={close}
          >
            ×
          </button>
        </div>

        {runId === null ? (
          <form className="modal-body" onSubmit={startFitCheck}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={withoutLink}
                onChange={(event) => setWithoutLink(event.target.checked)}
              />
              <span>Vaga sem link</span>
            </label>

            {withoutLink ? (
              <label className="field">
                <span>Cole a descrição da vaga</span>
                <textarea
                  rows={8}
                  required
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                />
              </label>
            ) : (
              <label className="field">
                <span>Link da vaga (URL)</span>
                <input
                  type="url"
                  required
                  placeholder="https://exemplo.com/vaga/engenheiro-de-software"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
            )}

            <label className="field">
              <span>Perguntas extras do formulário (se houver)</span>
              <textarea
                rows={3}
                placeholder="Uma por linha; vira 'Como responder' nos materiais."
                value={extraQuestions}
                onChange={(event) => setExtraQuestions(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Mensagem do recrutador (se houver)</span>
              <textarea
                rows={3}
                placeholder="LinkedIn / WhatsApp / e-mail; a resposta vai para 'Recrutador'."
                value={recruiterMessage}
                onChange={(event) => setRecruiterMessage(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Direcionamento para a cover letter (opcional)</span>
              <textarea
                rows={2}
                placeholder="Tom, ênfase e experiências a destacar. Nunca fonte de fatos."
                value={coverLetterGuidance}
                onChange={(event) => setCoverLetterGuidance(event.target.value)}
              />
            </label>

            <div className="modal-grid">
              <label className="field">
                <span>Idioma do currículo</span>
                <select
                  value={languagePreference}
                  onChange={(event) =>
                    setLanguagePreference(
                      event.target.value as typeof languagePreference,
                    )
                  }
                >
                  {LANGUAGES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Stack do currículo</span>
                <select
                  value={stack}
                  onChange={(event) => setStack(event.target.value)}
                >
                  <option value="ruby">Ruby (padrão)</option>
                  <option value="php">PHP</option>
                </select>
              </label>
            </div>

            <p className="muted modal-hint">
              O app analisa a vaga e para para você confirmar idioma e fit. Nada
              é enviado ao portal.
            </p>

            <div className="modal-footer">
              <button type="button" className="button ghost" onClick={close}>
                Cancelar
              </button>
              <button
                type="submit"
                className="button"
                disabled={fitCheck.isPending}
              >
                {fitCheck.isPending ? 'Analisando…' : '1/2 Analisar fit'}
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            {runQuery.isLoading ? (
              <p className="muted">Carregando processamento…</p>
            ) : null}

            {run ? (
              <>
                <p className="stage-line">
                  <strong>{STAGE_LABELS[run.stage] ?? run.stage}</strong>
                  {run.error ? (
                    <span className="inline-error"> — {run.error}</span>
                  ) : null}
                </p>

                {run.stage === 'scrape-thin' ? (
                  <div className="notice" role="status">
                    <strong>A página rendeu pouco texto</strong>
                    <p>
                      Cole a descrição da vaga para a IA conseguir avaliar o fit.
                    </p>
                    <textarea
                      rows={8}
                      value={rawText}
                      onChange={(event) => setRawText(event.target.value)}
                    />
                    <button
                      type="button"
                      className="button"
                      disabled={!rawText.trim() || fitCheck.isPending}
                      onClick={retryWithPastedText}
                    >
                      {fitCheck.isPending ? 'Reanalisando…' : 'Analisar texto colado'}
                    </button>
                  </div>
                ) : null}

                {busyStages.has(run.stage) ? (
                  <p className="muted">
                    {run.stage === 'generating'
                      ? 'Gerando o kit (CV, cover letter, e-mail e recrutador)…'
                      : 'Raspando a vaga e avaliando o fit…'}
                  </p>
                ) : null}

                {run.fit ? (
                  <div className="fit-summary">
                    <div className="panel-header">
                      <h3>Fit</h3>
                      <span className="fit-pill">
                        {formatFit(run.fit.rating)}
                      </span>
                    </div>
                    {run.fit.analysis ? <p>{run.fit.analysis}</p> : null}
                    {run.fit.gaps.length > 0 ? (
                      <p className="muted">Gaps: {run.fit.gaps.join(', ')}</p>
                    ) : null}
                    {run.fit.eligibility && !run.fit.eligibility.passed ? (
                      <p className="inline-error">
                        Elegibilidade: {run.fit.eligibility.reason}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {run.stage === 'needs_input' && run.llmQuestion ? (
                  <CheckpointPanel
                    question={run.llmQuestion}
                    rounds={run.needsInputRounds}
                    pending={respond.isPending}
                    error={
                      respond.error instanceof Error
                        ? respond.error.message
                        : null
                    }
                    onRespond={(input) =>
                      respond.mutate({ runId: run.id, input })
                    }
                  />
                ) : null}

                {run.stage === 'fit-checked' ? (
                  <>
                    <label className="field">
                      <span>Confirmar idioma do currículo</span>
                      <select
                        value={language}
                        onChange={(event) =>
                          setLanguage(event.target.value as 'pt-br' | 'en')
                        }
                      >
                        <option value="pt-br">Português (PT-BR)</option>
                        <option value="en">Inglês (English)</option>
                      </select>
                    </label>

                    {needsFitConfirm ? (
                      <label className="check-row warn">
                        <input
                          type="checkbox"
                          checked={fitConfirmed}
                          onChange={(event) =>
                            setFitConfirmed(event.target.checked)
                          }
                        />
                        <span>
                          Aderência baixa ou elegibilidade reprovada — confirmo
                          que desejo prosseguir mesmo assim.
                        </span>
                      </label>
                    ) : null}
                  </>
                ) : null}

                {run.stage === 'done' ? (
                  <p className="inline-ok">
                    Kit gerado.{' '}
                    {run.jobId ? (
                      <Link to={`/jobs/${run.jobId}`} onClick={close}>
                        Ver vaga
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}

            {error ? (
              <p className="inline-error" role="alert">
                {error instanceof Error ? error.message : 'Falha no processamento.'}
              </p>
            ) : null}

            <div className="modal-footer">
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  reset();
                }}
              >
                ← Nova análise
              </button>
              <button type="button" className="button ghost" onClick={close}>
                Fechar
              </button>
              <button
                type="button"
                className="button"
                disabled={!canGenerate || generateKit.isPending}
                onClick={generate}
              >
                {generateKit.isPending ? 'Enfileirando…' : '2/2 Gerar kit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
