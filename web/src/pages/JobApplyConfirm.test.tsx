import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

/**
 * Manual apply confirmation (D1). The button opens a small form and the
 * mutation always sends `approved: true`; the server keeps the human-in-the-loop
 * lock and answers 400 when the approval is missing.
 */

const fit: Fit = {
  rating: 70,
  analysis: 'Boa aderência.',
  strengths: ['Rails'],
  gaps: [],
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'app_8',
    ownerId: 'local',
    company: 'Acme',
    role: 'Rails Engineer',
    vacancyUrl: 'https://example.com/jobs/8',
    applyUrl: 'https://example.com/jobs/8/apply',
    language: 'en',
    stack: 'ruby',
    channel: 'linkedin',
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

interface StubOptions {
  job?: Job;
  confirmStatus?: number;
  confirmError?: string;
}

function stubApi(options: StubOptions = {}) {
  const job = options.job ?? makeJob();
  let jobReads = 0;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.endsWith(`/api/jobs/${job.id}/apply-confirm`)) {
        if (options.confirmError) {
          return jsonResponse(
            { error: options.confirmError },
            options.confirmStatus ?? 400,
          );
        }
        return jsonResponse({
          success: true,
          job: {
            ...job,
            status: 'applied',
            appliedAt: '2026-11-15T12:00:00.000Z',
            applyNote: 'Applied manually.',
            applyMethod: 'manual',
          },
        });
      }
      if (url.endsWith(`/api/jobs/${job.id}`)) {
        jobReads += 1;
        return jsonResponse({ job, runs: [], artifacts: [] });
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
  return { fetchMock, jobReads: () => jobReads };
}

function confirmCalls(
  fetchMock: ReturnType<typeof stubApi>['fetchMock'],
  jobId: string,
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(`/api/jobs/${jobId}/apply-confirm`) &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobDetail apply confirmation', () => {
  it('opens the form, sends approved: true with the fields and invalidates the job', async () => {
    const user = userEvent.setup();
    const { fetchMock, jobReads } = stubApi();
    renderWithProviders(<App />, ['/jobs/app_8']);

    await user.click(
      await screen.findByRole('button', { name: 'Marcar como aplicada' }),
    );

    await user.type(screen.getByLabelText('Nota'), 'Applied manually.');
    await user.clear(screen.getByLabelText('Canal'));
    await user.type(screen.getByLabelText('Canal'), 'Recruiter');
    await user.type(
      screen.getByLabelText('E-mails usados'),
      'a@example.com, b@example.com',
    );

    const readsBefore = jobReads();
    await user.click(screen.getByRole('button', { name: 'Enviar confirmação' }));

    await waitFor(() =>
      expect(confirmCalls(fetchMock, 'app_8')).toHaveLength(1),
    );

    const body = JSON.parse(
      String((confirmCalls(fetchMock, 'app_8')[0]?.[1] as RequestInit).body),
    );
    expect(body).toMatchObject({
      approved: true,
      note: 'Applied manually.',
      channel: 'Recruiter',
      appliedEmails: ['a@example.com', 'b@example.com'],
    });

    expect(await screen.findByText('Candidatura confirmada.')).toBeInTheDocument();
    await waitFor(() => expect(jobReads()).toBeGreaterThan(readsBefore));
  });

  it('shows the API 400 when the approval is rejected', async () => {
    const user = userEvent.setup();
    stubApi({
      confirmError:
        'Confirmação explícita necessária (approved: true). O app nunca envia sem seu "Sim".',
      confirmStatus: 400,
    });
    renderWithProviders(<App />, ['/jobs/app_8']);

    await user.click(
      await screen.findByRole('button', { name: 'Marcar como aplicada' }),
    );
    await user.click(screen.getByRole('button', { name: 'Enviar confirmação' }));

    expect(
      await screen.findByText(/Confirmação explícita necessária/i),
    ).toBeInTheDocument();
  });
});
