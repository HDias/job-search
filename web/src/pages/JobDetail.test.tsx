import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Artifact, Fit, Job, Run } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

const fit: Fit = {
  rating: 72,
  analysis: 'Boa aderência em Ruby.',
  dimensions: { skillsMatch: 70, experienceMatch: 80 },
  strengths: ['Ruby', 'PostgreSQL'],
  gaps: ['Kubernetes'],
  eligibility: { passed: true, reason: 'Remoto.' },
  languageGate: { required: 'en', passed: true, note: 'OK' },
  logisticsNote: null,
};

const job: Job = {
  id: 'app_1',
  ownerId: 'local',
  company: 'Acme',
  role: 'Backend Engineer',
  vacancyUrl: 'https://example.com/acme',
  applyUrl: null,
  language: 'en',
  stack: 'ruby',
  channel: 'linkedin',
  languageConfirmation: 'user-confirmed',
  status: 'applied',
  appliedAt: '2026-10-28T12:00:00.000Z',
  fit,
  appliedEmails: ['horecio@example.com'],
  coverLetterGuidance: null,
  coverInCvRequired: null,
  coverInCvReason: null,
  hasRecruiterMessage: true,
  hasQuestions: true,
  skillGrounded: true,
  fitConfirmed: true,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};

const runs: Run[] = [
  {
    id: 'proc_1',
    jobId: 'app_1',
    stage: 'generating',
    url: 'https://example.com/acme',
    stack: 'ruby',
    languagePreference: 'en',
    detectedLanguage: 'en',
    suggestedLanguage: null,
    needsLanguageConfirmation: false,
    needsFitConfirmation: false,
    eligibilityBlocked: false,
    hasRawText: true,
    hasExtraQuestions: true,
    hasRecruiterMessage: true,
    error: null,
    fit,
    job: null,
    jobSnapshot: {
      title: 'Backend Engineer',
      company: 'Acme',
      content: 'Descrição completa da vaga.',
    },
    llmQuestion: null,
    needsInputRounds: 0,
    clarificationHistory: [],
    coverLetterGuidance: null,
    includeCoverInCv: null,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  },
];

const artifacts: Artifact[] = [
  {
    id: 'art_1',
    jobId: 'app_1',
    runId: 'proc_1',
    kind: 'cv_pdf',
    relativePath: 'acme/curriculo.pdf',
    mime: 'application/pdf',
    sizeBytes: 2048,
    createdAt: '2026-10-28T12:00:00.000Z',
  },
  {
    id: 'art_2',
    jobId: 'app_1',
    runId: 'proc_1',
    kind: 'email_text',
    relativePath: 'acme/email.txt',
    mime: 'text/plain',
    sizeBytes: 128,
    createdAt: '2026-10-28T12:00:00.000Z',
  },
];

function stubApi() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'PATCH') {
        return jsonResponse({ ...job, status: 'interview' });
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 1,
          byStatus: { applied: 1 },
          averageFitRating: 72,
          appliedLast30Days: 1,
        });
      }
      if (url.endsWith('/api/jobs/app_1')) {
        return jsonResponse({ job, runs, artifacts });
      }
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items: [job], total: 1 });
      }
      throw new Error(`URL inesperada: ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobDetail', () => {
  it('mostra fit, processamentos e artefatos', async () => {
    stubApi();
    renderWithProviders(<App />, ['/jobs/app_1']);

    expect(
      await screen.findByRole('heading', { name: 'Backend Engineer' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);

    expect(screen.getByText('Boa aderência em Ruby.')).toBeInTheDocument();
    expect(screen.getByText('Ruby')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();

    expect(screen.getByText('Gerando kit')).toBeInTheDocument();
    expect(screen.getByText('Ver snapshot da vaga')).toBeInTheDocument();
    expect(screen.getByText('atualizando…')).toBeInTheDocument();

    const cv = screen.getByRole('link', { name: /Currículo \(PDF\)/ });
    expect(cv).toHaveAttribute('href', '/cv/app_1');

    const email = screen.getByRole('link', { name: /E-mail de candidatura/ });
    expect(email).toHaveAttribute('href', '/extras/app_1/email');
  });

  it('atualiza o status da candidatura via PATCH', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />, ['/jobs/app_1']);

    const select = await screen.findByLabelText('Status da candidatura');
    expect(select).toHaveValue('applied');

    await user.selectOptions(select, 'interview');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/jobs/app_1') &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      expect(String((call?.[1] as RequestInit).body)).toContain('"status":"interview"');
    });

    await waitFor(() => {
      expect(select).toHaveValue('interview');
    });
  });

  it('mostra vaga não encontrada em 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Vaga não encontrada' }, 404)),
    );

    renderWithProviders(<App />, ['/jobs/app_missing']);

    expect(await screen.findByText('Vaga não encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
