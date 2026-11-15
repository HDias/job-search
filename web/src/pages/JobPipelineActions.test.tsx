import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job, Run } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

/**
 * Discrete pipeline entrypoint (T5.5): the React UI enqueues a fit-check or a
 * kit generation and then relies on the 4 s polling of `/api/jobs/:id`.
 */

const fit: Fit = {
  rating: 66,
  analysis: 'Aderência média.',
  strengths: [],
  gaps: [],
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'app_5',
    ownerId: 'local',
    company: 'Initech',
    role: 'Platform Engineer',
    vacancyUrl: 'https://example.com/jobs/5',
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
    skillGrounded: null,
    fitConfirmed: true,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  };
}

const run: Run = {
  id: 'proc_5',
  jobId: 'app_5',
  stage: 'done',
  url: 'https://example.com/jobs/5',
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
  llmQuestion: null,
  needsInputRounds: 0,
  clarificationHistory: [],
  coverLetterGuidance: null,
  includeCoverInCv: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

interface StubOptions {
  job?: Job;
  runs?: Run[];
  enqueueStatus?: number;
  enqueueError?: string;
}

function stubApi(options: StubOptions = {}) {
  const job = options.job ?? makeJob();
  let jobReads = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.endsWith('/api/fit-check')) {
        if (options.enqueueError) {
          return jsonResponse({ error: options.enqueueError }, options.enqueueStatus ?? 409);
        }
        return jsonResponse({ runId: 'proc_new' }, 202);
      }
      if (method === 'POST' && url.endsWith('/api/generate-kit')) {
        if (options.enqueueError) {
          return jsonResponse({ error: options.enqueueError }, options.enqueueStatus ?? 409);
        }
        return jsonResponse({ runId: 'proc_gen' }, 202);
      }
      if (method === 'POST' && url.endsWith('/regenerate')) {
        if (options.enqueueError) {
          return jsonResponse({ error: options.enqueueError }, options.enqueueStatus ?? 409);
        }
        return jsonResponse({ runId: 'proc_regen' }, 202);
      }
      if (url.endsWith(`/api/jobs/${job.id}`)) {
        jobReads += 1;
        return jsonResponse({ job, runs: options.runs ?? [run], artifacts: [] });
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 1,
          byStatus: { drafted: 1 },
          averageFitRating: 66,
          appliedLast30Days: 0,
        });
      }
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items: [job], total: 1 });
      }
      throw new Error(`URL inesperada: ${method} ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, jobReads: () => jobReads };
}

function callsTo(
  fetchMock: ReturnType<typeof stubApi>['fetchMock'],
  suffix: string,
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(suffix) &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobDetail pipeline actions', () => {
  it('enqueues a fit-check with the vacancy URL and refetches the job', async () => {
    const user = userEvent.setup();
    const { fetchMock, jobReads } = stubApi();
    renderWithProviders(<App />, ['/jobs/app_5']);

    await user.click(await screen.findByRole('button', { name: 'Rodar fit-check' }));

    await waitFor(() => expect(callsTo(fetchMock, '/api/fit-check')).toHaveLength(1));

    const body = JSON.parse(
      String((callsTo(fetchMock, '/api/fit-check')[0]?.[1] as RequestInit).body),
    );
    expect(body.url).toBe('https://example.com/jobs/5');
    expect(body.processId).toBe('proc_5');
    expect(body.stack).toBe('ruby');

    await waitFor(() => expect(jobReads()).toBeGreaterThan(1));
  });

  it('enqueues a kit generation once the fit-check is done', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi({
      runs: [{ ...run, stage: 'fit-checked' }],
    });
    renderWithProviders(<App />, ['/jobs/app_5']);

    await user.click(await screen.findByRole('button', { name: 'Gerar kit' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/generate-kit')).toHaveLength(1),
    );

    const body = JSON.parse(
      String((callsTo(fetchMock, '/api/generate-kit')[0]?.[1] as RequestInit).body),
    );
    expect(body.processId).toBe('proc_5');
  });

  it('keeps both steps disabled while the fit-check is still running', async () => {
    stubApi({
      runs: [{ ...run, stage: 'scraping', fit: null }],
    });
    renderWithProviders(<App />, ['/jobs/app_5']);

    expect(
      await screen.findByRole('button', { name: 'Rodar fit-check' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gerar kit' })).toBeDisabled();
    expect(
      screen.getByText(/Aguarde o processamento atual/),
    ).toBeInTheDocument();
  });

  it('enables the kit only after the fit-check is checked and the gates pass', async () => {
    stubApi({ runs: [{ ...run, stage: 'fit-checked' }] });
    renderWithProviders(<App />, ['/jobs/app_5']);

    expect(
      await screen.findByRole('button', { name: 'Gerar kit' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rodar fit-check' })).toBeEnabled();
  });

  it('keeps the kit disabled when the fit-check still needs a confirmation', async () => {
    stubApi({
      runs: [{ ...run, stage: 'fit-checked', needsLanguageConfirmation: true }],
    });
    renderWithProviders(<App />, ['/jobs/app_5']);

    expect(
      await screen.findByRole('button', { name: 'Gerar kit' }),
    ).toBeDisabled();
  });

  it('rebuilds the kit once the generation is done', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi({ runs: [{ ...run, stage: 'done' }] });
    renderWithProviders(<App />, ['/jobs/app_5']);

    const button = await screen.findByRole('button', { name: 'Regerar kit' });
    expect(button).toBeEnabled();

    await user.click(button);

    await waitFor(() =>
      expect(
        callsTo(fetchMock, '/api/jobs/app_5/regenerate'),
      ).toHaveLength(1),
    );
  });

  it('shows a spinner on the kit button while it is generating', async () => {
    stubApi({ runs: [{ ...run, stage: 'generating', fit: null }] });
    renderWithProviders(<App />, ['/jobs/app_5']);

    const button = await screen.findByRole('button', { name: /Gerando kit/ });
    expect(button).toBeDisabled();
    expect(button.querySelector('.spinner')).not.toBeNull();
  });

  it('disables fit-check when the job has no source and no run', async () => {
    const { fetchMock } = stubApi({
      job: makeJob({ vacancyUrl: null }),
      runs: [],
    });
    renderWithProviders(<App />, ['/jobs/app_5']);

    expect(await screen.findByRole('button', { name: 'Rodar fit-check' })).toBeDisabled();
    expect(screen.getByText(/Sem link ou texto da vaga/)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/fit-check')).toHaveLength(0);
  });

  it('surfaces the 409 from the pipeline gate', async () => {
    const user = userEvent.setup();
    stubApi({
      runs: [{ ...run, stage: 'fit-checked' }],
      enqueueError: 'Confirme o idioma antes de gerar o kit',
      enqueueStatus: 409,
    });
    renderWithProviders(<App />, ['/jobs/app_5']);

    await user.click(await screen.findByRole('button', { name: 'Gerar kit' }));

    expect(
      await screen.findByText('Confirme o idioma antes de gerar o kit'),
    ).toBeInTheDocument();
  });
});
