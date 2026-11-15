import { useState } from 'react';
import type { LlmQuestion, RespondInput } from '../api/types';

type InferenceDecision = 'approve' | 'reject';

interface CheckpointPanelProps {
  question: LlmQuestion;
  rounds: number;
  pending: boolean;
  error: string | null;
  onRespond: (input: RespondInput) => void;
}

/**
 * Human checkpoint for a `needs_input` run (D6): the LLM asked for a fact or
 * for approval of inferred skills, and generation only resumes after the
 * answer. Everything is opt-in here — nothing is approved by default.
 */
export function CheckpointPanel({
  question,
  rounds,
  pending,
  error,
  onRespond,
}: CheckpointPanelProps) {
  const [answer, setAnswer] = useState('');
  const [decisions, setDecisions] = useState<Record<string, InferenceDecision>>(
    {},
  );

  const inferenceMode = question.kind === 'inference_approval';
  const approved = question.inferences
    .filter((inference) => decisions[inference.skill] === 'approve')
    .map((inference) => inference.skill);
  const rejected = question.inferences
    .filter((inference) => decisions[inference.skill] === 'reject')
    .map((inference) => inference.skill);

  const canSubmit = inferenceMode
    ? approved.length + rejected.length > 0
    : answer.trim().length > 0;

  function decide(skill: string, decision: InferenceDecision) {
    setDecisions((current) => ({ ...current, [skill]: decision }));
  }

  function submit() {
    if (!canSubmit || pending) return;

    const input: RespondInput = {};
    if (answer.trim()) input.answer = answer.trim();
    if (approved.length > 0) input.approvedInferences = approved;
    if (rejected.length > 0) input.rejectedInferences = rejected;

    onRespond(input);
  }

  return (
    <section className="panel checkpoint" aria-label="Checkpoint do pipeline">
      <div className="panel-header">
        <h2>Precisamos da sua resposta</h2>
        <span className="muted">
          rodada {Math.max(rounds, 1)} de 2
        </span>
      </div>

      <p className="checkpoint-question">{question.question}</p>

      {question.options.length > 0 ? (
        <div className="checkpoint-options" role="group" aria-label="Opções sugeridas">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className="chip chip-option"
              aria-pressed={answer === option}
              onClick={() => setAnswer(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {inferenceMode ? (
        <ul className="plain-list checkpoint-inferences">
          {question.inferences.map((inference) => (
            <li key={inference.skill}>
              <div>
                <strong>{inference.skill}</strong>
                <span className="muted"> · {inference.inferredFrom}</span>
              </div>
              <div className="link-row">
                <button
                  type="button"
                  className="button ghost"
                  aria-pressed={decisions[inference.skill] === 'approve'}
                  onClick={() => decide(inference.skill, 'approve')}
                >
                  Aprovar {inference.skill}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  aria-pressed={decisions[inference.skill] === 'reject'}
                  onClick={() => decide(inference.skill, 'reject')}
                >
                  Rejeitar {inference.skill}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="field">
        <span>
          {inferenceMode ? 'Observação (opcional)' : 'Sua resposta'}
        </span>
        <textarea
          value={answer}
          rows={3}
          placeholder={question.rawExcerpt || 'Responda de forma objetiva'}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </label>

      <div className="admin-actions">
        <button
          type="button"
          className="button"
          disabled={!canSubmit || pending}
          onClick={submit}
        >
          {pending ? 'Enviando…' : 'Enviar resposta'}
        </button>
      </div>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
