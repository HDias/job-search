import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job, JobStats, LlmQuestion, Run } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

const stats: JobStats = {
  total: 0,
  byStatus: {},
  averageFitRating: null,
  appliedLast30Days: 0,
};

const fit: Fit = {
  rating: 72,
  analysis: 'Boa aderência ao stack.',
  strengths: ['Rails'],
  gaps: ['Kubernetes'],
};

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'proc_1',
    jobId: null,
    stage: 'fit-checked',
    url: 'https://example.com/jobs/1',
    stack: 'ruby',
    languagePreference: 'auto',
    detectedLanguage: 'en',
    suggestedLanguage: 'en',
    needsLanguageConfirmation: true,
    needsFitConfirmation: false,
    eligibilityBlocked: false,
    hasRawText: false,
    hasExtraQuestions: false,
    hasRecruiterMessage: false,
    error: null,
    fit,
    job: {
      title: 'Backend Engineer',
      company: 'Acme',
      url: 'https://example.com/jobs/1',
      detectedLanguage: 'en',
    },
    jobSnapshot: {
      title: 'Backend Engineer',
      company: 'Acme',
      url: 'https://example.com/jobs/1',
      content: 'Rails engineer.',
    },
    llmQuestion: null,
    needsInputRounds: 0,
    clarificationHistory: [],
    coverLetterGuidance: null,
    includeCoverInCv: null,
    createdAt: '2026-11-15T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    ...overrides,
  };
}

const job: Job = {
  id: 'app_1',
  ownerId: 'local',
  company: 'Acme',
  role: 'Backend Engineer',
  vacancyUrl: null,
  applyUrl: null,
  language: 'en',
  stack: 'ruby',
  channel: null,
  languageConfirmation: null,
  status: 'drafted',
  appliedAt: null,
  fit: null,
  appliedEmails: [],
  applyNote: null,
  applyMethod: 'manual',
  chatHistory: [],
  coverLetterGuidance: null,
  coverInCvRequired: null,
  coverInCvReason: null,
  hasRecruiterMessage: false,
  hasQuestions: false,
  skillGrounded: null,
  fitConfirmed: null,
  createdAt: '2026-11-15T12:00:00.000Z',
  updatedAt: '2026-11-15T12:00:00.000Z',
};

function stubApi(currentRun: Run) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/stats')) return jsonResponse(stats);
      if (method === 'POST' && url.endsWith('/api/fit-check')) {
        return jsonResponse({ runId: 'proc_1' }, 202);
      }
      if (method === 'POST' && url.endsWith('/api/generate-kit')) {
        return jsonResponse({ runId: 'proc_1' }, 202);
      }
      if (method === 'POST' && url.endsWith('/api/runs/proc_1/respond')) {
        return jsonResponse({ success: true }, 202);
      }
      if (url.endsWith('/api/runs/proc_1')) return jsonResponse(currentRun);
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items: [job], total: 1 });
      }
      throw new Error(`URL inesperada: ${method} ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsTo(
  fetchMock: ReturnType<typeof stubApi>,
  suffix: string,
  method: string,
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(suffix) &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('New job modal', () => {
  it('analisa a vaga pela URL e gera o kit com o idioma confirmado', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(makeRun());
    renderWithProviders(<App />);

    await user.click(
      await screen.findByRole('button', { name: /Nova vaga com IA/ }),
    );

    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(/Link da vaga/),
      'https://example.com/jobs/1',
    );
    await user.click(
      within(dialog).getByRole('button', { name: /1\/2 Analisar fit/ }),
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/fit-check', 'POST')).toHaveLength(1),
    );
    const fitBody = JSON.parse(
      String((callsTo(fetchMock, '/api/fit-check', 'POST')[0]?.[1] as RequestInit).body),
    );
    expect(fitBody).toMatchObject({
      url: 'https://example.com/jobs/1',
      stack: 'ruby',
      languagePreference: 'auto',
    });

    expect(await within(dialog).findByText('72%')).toBeInTheDocument();
    const language = within(dialog).getByLabelText('Confirmar idioma do currículo');
    await user.selectOptions(language, 'en');

    await user.click(
      within(dialog).getByRole('button', { name: /2\/2 Gerar kit/ }),
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/generate-kit', 'POST')).toHaveLength(1),
    );
    const kitBody = JSON.parse(
      String(
        (callsTo(fetchMock, '/api/generate-kit', 'POST')[0]?.[1] as RequestInit)
          .body,
      ),
    );
    expect(kitBody).toMatchObject({
      processId: 'proc_1',
      language: 'en',
      fitConfirmed: true,
    });
  });

  it('mostra a pergunta da LLM e envia a resposta do checkpoint', async () => {
    const user = userEvent.setup();
    const question: LlmQuestion = {
      question: 'Qual foi o seu salário esperado?',
      options: [],
      blockingField: 'salary',
      kind: 'missing_fact',
      inferences: [],
      rawExcerpt: '',
    };
    const fetchMock = stubApi(
      makeRun({
        stage: 'needs_input',
        llmQuestion: question,
        needsInputRounds: 1,
      }),
    );
    renderWithProviders(<App />);

    await user.click(
      await screen.findByRole('button', { name: /Nova vaga com IA/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(/Link da vaga/),
      'https://example.com/jobs/1',
    );
    await user.click(
      within(dialog).getByRole('button', { name: /1\/2 Analisar fit/ }),
    );

    expect(
      await within(dialog).findByText('Qual foi o seu salário esperado?'),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Sua resposta'), 'R$ 15k');
    await user.click(
      within(dialog).getByRole('button', { name: 'Enviar resposta' }),
    );

    await waitFor(() =>
      expect(
        callsTo(fetchMock, '/api/runs/proc_1/respond', 'POST'),
      ).toHaveLength(1),
    );
    const body = JSON.parse(
      String(
        (callsTo(fetchMock, '/api/runs/proc_1/respond', 'POST')[0]?.[1] as RequestInit)
          .body,
      ),
    );
    expect(body).toEqual({ answer: 'R$ 15k' });
  });
});
