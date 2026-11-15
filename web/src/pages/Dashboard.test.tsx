import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Fit, Job, JobStats, Run } from '../api/types';
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'proc_9',
    jobId: null,
    stage: 'fit-checked',
    url: 'https://example.com/jobs/9',
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
      title: 'Platform Engineer',
      company: 'Globex',
      url: 'https://example.com/jobs/9',
      detectedLanguage: 'en',
    },
    jobSnapshot: {
      title: 'Platform Engineer',
      company: 'Globex',
      url: 'https://example.com/jobs/9',
      content: 'Ruby and Rails.',
    },
    llmQuestion: null,
    needsInputRounds: 0,
    clarificationHistory: [],
    coverLetterGuidance: null,
    includeCoverInCv: null,
    createdAt: '2026-11-14T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    ...overrides,
  };
}

function stubApi(
  items: Job[] = jobs,
  total = items.length,
  runs: Run[] = [],
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url.startsWith('/api/jobs/')) {
        return jsonResponse({}, 204);
      }
      if (method === 'DELETE' && url.startsWith('/api/runs/')) {
        return jsonResponse({}, 204);
      }
      if (url.startsWith('/api/runs/')) {
        const id = url.split('/').at(-1);
        const run = runs.find((entry) => entry.id === id);
        if (!run) return jsonResponse({ error: 'Processo não encontrado' }, 404);
        return jsonResponse(run);
      }
      if (url.startsWith('/api/runs')) return jsonResponse(runs);
      if (method === 'POST' && url.endsWith('/apply-confirm')) {
        const id = url.split('/').at(-2);
        const job = items.find((entry) => entry.id === id);
        if (!job) return jsonResponse({ error: 'Vaga não encontrada' }, 404);
        return jsonResponse({
          success: true,
          job: {
            ...job,
            status: 'applied',
            appliedAt: '2026-11-15T12:00:00.000Z',
            applyMethod: 'manual',
          },
        });
      }
      if (method === 'PATCH' && url.startsWith('/api/jobs/')) {
        const id = url.split('/').at(-1);
        const job = items.find((entry) => entry.id === id);
        const patch = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({ ...job, ...patch });
      }
      if (url.startsWith('/api/stats')) return jsonResponse(stats);
      if (url.startsWith('/api/jobs')) {
        return jsonResponse({ items, total });
      }
      throw new Error(`URL inesperada: ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    expect(within(table).getAllByLabelText('Status da vaga')).toHaveLength(2);
    expect(within(table).getByDisplayValue('Aplicado')).toBeInTheDocument();
    expect(within(table).getByDisplayValue('Rascunho')).toBeInTheDocument();
    expect(within(table).getByText('72%')).toBeInTheDocument();
  });

  it('muda o status pela lista e confirma a aplicação em "Aplicado"', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />);

    const betaRow = (await screen.findByText('Beta')).closest('tr') as HTMLElement;
    const acmeRow = screen.getByText('Acme').closest('tr') as HTMLElement;

    await user.selectOptions(
      within(betaRow).getByLabelText('Status da vaga'),
      'applied',
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/jobs/app_2/apply-confirm') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        approved: true,
      });
    });

    await user.selectOptions(
      within(acmeRow).getByLabelText('Status da vaga'),
      'interview',
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/jobs/app_1') &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        status: 'interview',
      });
    });
  });

  it('exclui definitivamente uma vaga da listagem', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<App />);

    const row = (await screen.findByText('Beta')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith('/api/jobs/app_2?purge=true') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true);
    });
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

  it('mostra processos interrompidos e retoma o checkpoint salvo', async () => {
    const user = userEvent.setup();
    stubApi(jobs, jobs.length, [makeRun()]);
    renderWithProviders(<App />);

    const section = await screen.findByRole('region', {
      name: 'Processos interrompidos',
    });
    expect(within(section).getByText('Globex')).toBeInTheDocument();
    expect(within(section).getByText('Fit calculado')).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', { name: /Continuar/ }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('72%')).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText('Confirmar idioma do currículo'),
    ).toHaveValue('en');
  });

  it('descarta um processo interrompido', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(jobs, jobs.length, [makeRun()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<App />);

    const section = await screen.findByRole('region', {
      name: 'Processos interrompidos',
    });
    await user.click(within(section).getByRole('button', { name: 'Descartar' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith('/api/runs/proc_9') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
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
