import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Artifact, Fit, Job } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

/**
 * Application-question extraction (D8): the React UI only consumes the
 * endpoint, and never launches Chromium — the API is stubbed here.
 */

const fit: Fit = {
  rating: 70,
  analysis: 'Boa aderência.',
  strengths: ['Rails'],
  gaps: [],
  eligibility: { passed: true, reason: 'Remote.' },
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'app_7',
    ownerId: 'local',
    company: 'Acme',
    role: 'Rails Engineer',
    vacancyUrl: 'https://example.com/jobs/7',
    applyUrl: 'https://example.com/jobs/7/apply',
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

const kitArtifact: Artifact = {
  id: 'art_1',
  jobId: 'app_7',
  runId: null,
  kind: 'cv_pdf',
  relativePath: 'acme_rails_engineer/curriculo.pdf',
  mime: 'application/pdf',
  sizeBytes: 1024,
  createdAt: '2026-11-02T10:00:00.000Z',
};

interface StubOptions {
  job?: Job;
  artifacts?: Artifact[];
  questionsStatus?: number;
  questionsError?: string;
}

function stubApi(options: StubOptions = {}) {
  const job = options.job ?? makeJob();
  const artifacts = options.artifacts ?? [kitArtifact];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.endsWith(`/api/jobs/${job.id}/questions`)) {
        if (options.questionsError) {
          return jsonResponse(
            { error: options.questionsError },
            options.questionsStatus ?? 400,
          );
        }
        return jsonResponse({
          success: true,
          platform: 'greenhouse',
          questions: [
            { id: 'q1', label: 'Years of Rails?', type: 'select', required: true, options: ['1-3'], name: 'q1', category: 'custom' },
            { id: 'q2', label: 'Visa?', type: 'select', required: true, options: ['Yes', 'No'], name: 'q2', category: 'legal' },
            { id: 'q3', label: 'Gender', type: 'select', required: false, options: null, name: 'q3', category: 'demographic' },
          ],
          standardFields: [
            { id: 'email', label: 'Email', type: 'email', required: true, options: null, name: 'email' },
          ],
          questionsUrl: '/applications/acme_rails_engineer/application_questions.json',
        });
      }

      if (url.endsWith(`/api/jobs/${job.id}`)) {
        return jsonResponse({ job, runs: [], artifacts });
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 1,
          byStatus: { drafted: 1 },
          averageFitRating: 70,
          appliedLast30Days: 0,
        });
      }
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items: [job], total: 1 });
      }
      throw new Error(`Unexpected URL: ${method} ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock };
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

describe('JobDetail apply actions', () => {
  it('disables the extract action without a URL or a kit', async () => {
    stubApi({
      job: makeJob({ applyUrl: null, vacancyUrl: null }),
      artifacts: [],
    });
    renderWithProviders(<App />, ['/jobs/app_7']);

    expect(
      await screen.findByRole('button', { name: 'Extrair perguntas' }),
    ).toBeDisabled();
    expect(screen.getByText(/URL de candidatura e o kit/i)).toBeInTheDocument();
  });

  it('extracts the application questions and shows the platform summary', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi();
    renderWithProviders(<App />, ['/jobs/app_7']);

    await user.click(
      await screen.findByRole('button', { name: 'Extrair perguntas' }),
    );

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/jobs/app_7/questions')).toHaveLength(1),
    );
    expect(await screen.findByText(/Plataforma: greenhouse/i)).toBeInTheDocument();
    expect(screen.getByText(/3 perguntas extraídas/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver perguntas' })).toHaveAttribute(
      'href',
      '/applications/acme_rails_engineer/application_questions.json',
    );
  });

  it('surfaces the API error for a missing kit (400)', async () => {
    const user = userEvent.setup();
    stubApi({
      questionsError: 'Gere o kit antes de extrair as perguntas da candidatura.',
      questionsStatus: 400,
    });
    renderWithProviders(<App />, ['/jobs/app_7']);

    await user.click(
      await screen.findByRole('button', { name: 'Extrair perguntas' }),
    );

    expect(
      await screen.findByText(
        'Gere o kit antes de extrair as perguntas da candidatura.',
      ),
    ).toBeInTheDocument();
  });
});
