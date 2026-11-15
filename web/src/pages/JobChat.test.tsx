import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { ChatMessage, Fit, Job } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

/**
 * Post-response chat (D3/D6): free-form conversation plus quick actions that
 * send predefined prompts through the same synchronous endpoint.
 */

const fit: Fit = {
  rating: 82,
  analysis: 'Strong Rails background.',
  strengths: ['Rails'],
  gaps: ['Kubernetes'],
};

const history: ChatMessage[] = [
  { role: 'user', content: 'Qual é o canal da candidatura?', at: '2026-11-14T10:00:00.000Z' },
  { role: 'assistant', content: 'O canal registrado é o portal.', at: '2026-11-14T10:00:05.000Z' },
];

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'app_9',
    ownerId: 'local',
    company: 'Acme',
    role: 'Rails Engineer',
    vacancyUrl: 'https://example.com/jobs/9',
    applyUrl: null,
    language: 'en',
    stack: 'ruby',
    channel: null,
    languageConfirmation: 'user-confirmed',
    status: 'applied',
    appliedAt: '2026-11-14T09:00:00.000Z',
    fit,
    appliedEmails: [],
    applyNote: null,
    applyMethod: 'manual',
    chatHistory: history,
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
  chatStatus?: number;
  chatError?: string;
}

function stubApi(options: StubOptions = {}) {
  const job = options.job ?? makeJob();

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.endsWith(`/api/jobs/${job.id}/chat`)) {
        if (options.chatError) {
          return jsonResponse(
            { error: options.chatError },
            options.chatStatus ?? 409,
          );
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { message: string };
        const chat: ChatMessage[] = [
          ...job.chatHistory,
          { role: 'user', content: body.message, at: '2026-11-15T12:00:00.000Z' },
          { role: 'assistant', content: 'Fit forte, com gap em Kubernetes.', at: '2026-11-15T12:00:01.000Z' },
        ];
        return jsonResponse({ success: true, reply: 'Fit forte, com gap em Kubernetes.', chat });
      }
      if (url.endsWith(`/api/jobs/${job.id}`)) {
        return jsonResponse({ job, runs: [], artifacts: [] });
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 1,
          byStatus: { applied: 1 },
          averageFitRating: 82,
          appliedLast30Days: 1,
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

function chatCalls(
  fetchMock: ReturnType<typeof stubApi>['fetchMock'],
  jobId: string,
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(`/api/jobs/${jobId}/chat`) &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

function lastMessage(fetchMock: ReturnType<typeof stubApi>['fetchMock'], jobId: string) {
  const calls = chatCalls(fetchMock, jobId);
  const body = JSON.parse(String((calls.at(-1)?.[1] as RequestInit).body));
  return body.message as string;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobDetail chat panel', () => {
  it('renders the persisted thread', async () => {
    stubApi();
    renderWithProviders(<App />, ['/jobs/app_9']);

    expect(
      await screen.findByText('Qual é o canal da candidatura?'),
    ).toBeInTheDocument();
    expect(screen.getByText('O canal registrado é o portal.')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Assistente')).toBeInTheDocument();
  });

  it('sends a free message and appends the reply', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi();
    renderWithProviders(<App />, ['/jobs/app_9']);

    await user.type(
      await screen.findByLabelText('Mensagem'),
      'Resuma o fit.',
    );
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() =>
      expect(chatCalls(fetchMock, 'app_9')).toHaveLength(1),
    );
    expect(lastMessage(fetchMock, 'app_9')).toBe('Resuma o fit.');
    expect(
      await screen.findByText('Fit forte, com gap em Kubernetes.'),
    ).toBeInTheDocument();
  });

  it('sends the predefined prompt from a quick action', async () => {
    const user = userEvent.setup();
    const { fetchMock } = stubApi();
    renderWithProviders(<App />, ['/jobs/app_9']);

    await user.click(await screen.findByRole('button', { name: 'Apontar gaps' }));

    await waitFor(() =>
      expect(chatCalls(fetchMock, 'app_9')).toHaveLength(1),
    );
    expect(lastMessage(fetchMock, 'app_9')).toBe(
      'Quais são os gaps do meu perfil para esta vaga?',
    );
    expect(
      await screen.findByText('Fit forte, com gap em Kubernetes.'),
    ).toBeInTheDocument();
  });

  it('shows the 409 when the job has no context', async () => {
    const user = userEvent.setup();
    stubApi({
      chatError:
        'Rode o fit-check e gere o snapshot da vaga antes de conversar sobre ela.',
      chatStatus: 409,
    });
    renderWithProviders(<App />, ['/jobs/app_9']);

    await user.type(
      await screen.findByLabelText('Mensagem'),
      'Resuma o fit.',
    );
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(
      await screen.findByText(/Rode o fit-check e gere o snapshot/i),
    ).toBeInTheDocument();
  });
});
