import { z } from 'zod';
import {
  NEEDS_INPUT_ANSWER_LIMIT,
  type ClarificationEntry,
  type Run,
} from '../../domain/run.js';
import type { GenerateKitPayload } from '../queue.js';
import type { Store } from '../../repositories/types.js';

/**
 * Interactive queue answer (port of v1 `/api/processes/:id/respond`): validates
 * the answer against the offered question, appends to `clarificationHistory`
 * (last 2 entries, 2000 chars) and builds the queued `generate-kit` payload.
 * Pure with respect to the queue — the route enqueues the returned payload.
 */

export const respondInputSchema = z.object({
  answer: z.string().optional(),
  approvedInferences: z.array(z.string()).optional(),
  rejectedInferences: z.array(z.string()).optional(),
  coverLetterGuidance: z.string().optional(),
  includeCoverInCv: z.union([z.string(), z.boolean()]).optional(),
});

export interface RespondInput {
  answer?: string | null;
  approvedInferences?: string[] | null;
  rejectedInferences?: string[] | null;
  coverLetterGuidance?: string | null;
  includeCoverInCv?: string | boolean | null;
}

export type RespondPlan =
  | { status: 'not_found' }
  | { status: 'not_waiting' }
  | { status: 'empty_answer'; error: string }
  | { status: 'unknown_inference'; error: string }
  | {
      status: 'queued';
      run: Run;
      history: ClarificationEntry[];
      coverLetterGuidance: string | null;
      payload: GenerateKitPayload;
    };

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 80)),
    ),
  ].slice(0, max);
}

export function planResponse(
  store: Pick<Store, 'runs'>,
  runId: string,
  input: RespondInput,
): RespondPlan {
  const run = store.runs.get(runId);
  if (!run) return { status: 'not_found' };
  if (run.stage !== 'needs_input' || !run.llmQuestion) {
    return { status: 'not_waiting' };
  }

  const question = run.llmQuestion;
  const kind =
    question.kind === 'inference_approval' ? 'inference_approval' : 'missing_fact';
  const answer = String(input.answer ?? '')
    .trim()
    .slice(0, NEEDS_INPUT_ANSWER_LIMIT);
  const approvedInferences = cleanList(input.approvedInferences, 5);
  const rejectedInferences = cleanList(input.rejectedInferences, 10);

  if (kind === 'missing_fact' && !answer) {
    return {
      status: 'empty_answer',
      error: 'Resposta vazia. Informe a clarificação ou descarte o processo.',
    };
  }

  if (approvedInferences.length > 0) {
    const offered = new Set(
      (question.inferences ?? []).map((inference) => String(inference.skill ?? '').trim()),
    );
    const unknown = approvedInferences.filter((skill) => !offered.has(skill));
    if (unknown.length > 0) {
      return {
        status: 'unknown_inference',
        error: `Inferência(s) desconhecida(s): ${unknown.join(
          ', ',
        )}. Aprove apenas as oferecidas.`,
      };
    }
  }

  const entry: ClarificationEntry = {
    answer,
    approvedInferences,
    rejectedInferences,
    at: new Date().toISOString(),
  };
  const history = [...(run.clarificationHistory ?? []), entry].slice(-2);
  const combinedAnswer = history
    .map((item) => item.answer)
    .filter(Boolean)
    .join('\n')
    .slice(0, NEEDS_INPUT_ANSWER_LIMIT);
  const combinedApproved = [
    ...new Set(history.flatMap((item) => item.approvedInferences ?? [])),
  ].slice(0, 5);
  const combinedRejected = [
    ...new Set(history.flatMap((item) => item.rejectedInferences ?? [])),
  ].slice(0, 10);

  const coverLetterGuidance =
    input.coverLetterGuidance !== undefined
      ? String(input.coverLetterGuidance ?? '')
          .trim()
          .slice(0, 2000)
      : run.coverLetterGuidance;

  return {
    status: 'queued',
    run,
    history,
    coverLetterGuidance,
    payload: {
      language:
        run.languagePreference && run.languagePreference !== 'auto'
          ? run.languagePreference
          : null,
      stack: run.stack,
      fitConfirmed: true,
      userAnswer: combinedAnswer,
      approvedInferences: combinedApproved,
      rejectedInferences: combinedRejected,
      needsInputRounds: run.needsInputRounds || 1,
      coverLetterGuidance,
      includeCoverInCv: input.includeCoverInCv ?? run.includeCoverInCv,
    },
  };
}
