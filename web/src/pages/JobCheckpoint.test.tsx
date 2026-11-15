import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job, LlmQuestion, Run } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

/**
 * Interactive checkpoint (D6/T5.3): the React UI answers a `needs_input` run
 * instead of sending the user back to the v1 interface.
 */

const fit: Fit = {
  rating: 80,
  analysis: 'Boa aderência.',
  strengths: ['Ruby'],
  gaps: [],
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
};

const job: Job = {
  id: 'app_7',
  ownerId: 'local',
  company: 'Globex',
  role: 'Rails Engineer',
  vacancyUrl: null,
  applyUrl: null,
  language: 'en',
  stack: 'ruby',
  channel: null,
  languageConfirmation: 'user-confirmed',
  status: 'drafted',
  appliedAt: null,
  fit,
  appliedEmails: [],
  applyNote: null,
  applyMethod: 'manual',
  chatHistory: [],
  coverLetterGuidance: null,
  coverInCvRequired: null,
  coverInCvReason: null,
  hasRecruiterMessage: false,
  hasQuestions: false,
  skillGrounded: true,
  fitConfirmed: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const MISSING_FACT: LlmQuestion = {
  question: 'Qual versão do PostgreSQL você usou em produção?',
  options: ['PostgreSQL 12', 'PostgreSQL 14'],
  blockingField: 'postgres_version',
  kind: 'missing_fact',
  inferences: [],
  rawExcerpt: '',
};

const INFERENCE: LlmQuestion = {
  question: 'Posso citar Kubernetes?',
  options: [],
  blockingField: 'kubernetes',
  kind: 'inference_approval',
  inferences: [
    { skill: 'Kubernetes', inferredFrom: 'Docker em produção', confidence: 'high' },
    { skill: 'Terraform', inferredFrom: 'AWS', confidence: 'high' },
  ],
  rawExcerpt: '',
};

function runWith(question: LlmQuestion, stage = 'needs_input'): Run {
  return {
    id: 'proc_9',
    jobId: job.id,
    stage,
    url: null,
    stack: 'ruby',
    languagePreference: 'en',
    detectedLanguage: 'en',
    suggestedLanguage: null,
    needsLanguageConfirmation: false,
    needsFitConfirmation: false,
    eligibilityBlocked: false,
    hasRawText: true,
    hasExtraQuestions: false,
    hasRecruiterMessage: false,
    error: null,
    fit,
    job: null,
    jobSnapshot: null,
    llmQuestion: question,
    needsInputRounds: 1,
    clarificationHistory: [],
    coverLetterGuidance: null,
    includeCoverInCv: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

function stubApi(question: LlmQuestion) {
  let jobReads = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'POST' && url.endsWith('/api/runs/proc_9/respond')) {
        return jsonResponse({ runId: 'proc_9' }, 202);
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 1,
          byStatus: { drafted: 1 },
          averageFitRating: 80,
          appliedLast30Days: 0,
        });
      }
      if (url.endsWith('/api/jobs/app_7')) {
        jobReads += 1;
        const runs = [runWith(question, jobReads === 1 ? 'needs_input' : 'generating')];
        return jsonResponse({ job, runs, artifacts: [] });
      }
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items: [job], total: 1 });
      }
      throw new Error(`URL inesperada: ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    jobReads: () => jobReads,
  };
}

function respondCalls(fetchMock: ReturnType<typeof stubApi>['fetchMock']) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith('/api/runs/proc_9/respond') &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobDetail checkpoint', () => {
  it('renders the question and options, answers it and refetches the job', async () => {
    const user = userEvent.setup();
    const { fetchMock, jobReads } = stubApi(MISSING_FACT);
    renderWithProviders(<App />, ['/jobs/app_7']);

    expect(
      await screen.findByText('Qual versão do PostgreSQL você usou em produção?'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'PostgreSQL 14' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() => expect(respondCalls(fetchMock)).toHaveLength(1));

    const body = JSON.parse(
      String((respondCalls(fetchMock)[0]?.[1] as RequestInit).body),
    ) as { answer?: string };
    expect(body.answer).toBe('PostgreSQL 14');

    // Invalidating `['job', id]` refetches the detail: the panel goes away.
    await waitFor(() => expect(jobReads()).toBeGreaterThan(1));
    await waitFor(() =>
      expect(
        screen.queryByText('Qual versão do PostgreSQL você usou em produção?'),
      ).not.toBeInTheDocument(),
    );
  });

  it('blocks an empty answer for a missing fact', async () => {
    const { fetchMock } = stubApi(MISSING_FACT);
    renderWithProviders(<App />, ['/jobs/app_7']);

    const submit = await screen.findByRole('button', { name: 'Enviar resposta' });
    expect(submit).toBeDisabled();
    expect(respondCalls(fetchMock)).toHaveLength(0);
  });

  it('approves and rejects inferred skills', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi(INFERENCE);
    renderWithProviders(<App />, ['/jobs/app_7']);

    expect(await screen.findByText('Posso citar Kubernetes?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aprovar Kubernetes' }));
    await user.click(screen.getByRole('button', { name: 'Rejeitar Terraform' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() => expect(respondCalls(fetchMock)).toHaveLength(1));

    const body = JSON.parse(
      String((respondCalls(fetchMock)[0]?.[1] as RequestInit).body),
    ) as { approvedInferences?: string[]; rejectedInferences?: string[] };
    expect(body.approvedInferences).toEqual(['Kubernetes']);
    expect(body.rejectedInferences).toEqual(['Terraform']);
  });

  it('shows the API error without losing the answer', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/api/runs/proc_9/respond')) {
          return jsonResponse({ error: 'Resposta não corresponde à pergunta' }, 400);
        }
        if (url.endsWith('/api/jobs/app_7')) {
          return jsonResponse({ job, runs: [runWith(MISSING_FACT)], artifacts: [] });
        }
        if (url.startsWith('/api/stats')) {
          return jsonResponse({
            total: 1,
            byStatus: { drafted: 1 },
            averageFitRating: 80,
            appliedLast30Days: 0,
          });
        }
        return jsonResponse({ items: [job], total: 1 });
      }),
    );

    renderWithProviders(<App />, ['/jobs/app_7']);

    await user.click(
      await screen.findByRole('button', { name: 'PostgreSQL 12' }),
    );
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(
      await screen.findByText('Resposta não corresponde à pergunta'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PostgreSQL 12' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
