import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job, JobStats } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

const stats: JobStats = {
  total: 16,
  byStatus: { applied: 13, drafted: 2, interview: 1 },
  averageFitRating: 69.9,
  appliedLast30Days: 12,
};

const fit: Fit = {
  rating: 72,
  analysis: 'Boa aderência.',
  dimensions: { skillsMatch: 70, experienceMatch: 80 },
  strengths: ['Ruby'],
  gaps: ['Kubernetes'],
};

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 'app_1',
    ownerId: 'local',
    company: 'Acme',
    role: 'Backend Engineer',
    vacancyUrl: null,
    applyUrl: null,
    language: 'en',
    stack: 'ruby',
    channel: 'linkedin',
    languageConfirmation: null,
    status: 'applied',
    appliedAt: '2026-10-28T12:00:00.000Z',
    fit: null,
    appliedEmails: [],
    coverLetterGuidance: null,
    coverInCvRequired: null,
    coverInCvReason: null,
    hasRecruiterMessage: false,
    hasQuestions: false,
    skillGrounded: null,
    fitConfirmed: null,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

const jobs: Job[] = [
  makeJob({ id: 'app_1', company: 'Acme', role: 'Backend Engineer', status: 'applied', fit }),
  makeJob({
    id: 'app_2',
    company: 'Beta',
    role: 'Frontend Engineer',
    status: 'drafted',
    channel: null,
    appliedAt: null,
  }),
];

function stubApi(items: Job[] = jobs, total = items.length) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/stats')) return jsonResponse(stats);
    if (url.startsWith('/api/jobs')) {
      return jsonResponse({ items, total });
    }
    throw new Error(`URL inesperada: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Dashboard', () => {
  it('mostra estatísticas e a lista de vagas', async () => {
    stubApi();
    renderWithProviders(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();

    const statsRegion = screen.getByRole('region', { name: 'Estatísticas' });
    expect(within(statsRegion).getByText('16')).toBeInTheDocument();
    expect(within(statsRegion).getByText('70%')).toBeInTheDocument();
    expect(within(statsRegion).getByText('13')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Backend Engineer')).toBeInTheDocument();
    expect(within(table).getByText('Rascunho')).toBeInTheDocument();
    expect(within(table).getByText('72%')).toBeInTheDocument();
  });

  it('envia o filtro de status para a API', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />);

    await screen.findByText('Acme');
    await user.selectOptions(screen.getByLabelText('Status'), 'applied');

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('status=applied')),
      ).toBe(true);
    });
  });

  it('envia a busca textual para a API', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />);

    await screen.findByText('Acme');
    await user.type(screen.getByLabelText('Buscar'), 'acme');

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('q=acme')),
      ).toBe(true);
    });
  });

  it('mostra estado vazio quando não há resultados', async () => {
    stubApi([]);
    renderWithProviders(<App />);

    expect(await screen.findByText('Nenhuma vaga encontrada')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lê filtros e página da URL', async () => {
    const fetchMock = stubApi(jobs, 60);
    renderWithProviders(<App />, ['/?status=interview&page=2']);

    await screen.findByText('Acme');
    expect(screen.getByLabelText('Status')).toHaveValue('interview');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/api/jobs'),
      );
      expect(String(call?.[0])).toContain('status=interview');
      expect(String(call?.[0])).toContain('limit=25');
      expect(String(call?.[0])).toContain('offset=25');
    });
  });

  it('pagina e atualiza a URL', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(jobs, 60);
    renderWithProviders(<App />, ['/?page=2']);

    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próxima →' }));

    expect(await screen.findByText('Página 3 de 3')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('offset=50')),
      ).toBe(true);
    });
  });

  it('mostra erro e permite tentar novamente', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Falha no servidor' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<App />);

    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument();
    expect(screen.getAllByText('Falha no servidor').length).toBeGreaterThan(0);

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Tentar novamente' })[0]);
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
