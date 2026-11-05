import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { BaseResumeMap, CandidateData, PdfTheme, Profile } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

const baseResumes: BaseResumeMap = {
  'pt-br': {
    exists: true,
    language: 'pt-br',
    sourceFile: 'curriculo_base_pt_br.html',
    updatedAt: '2026-10-20T12:00:00.000Z',
    charCount: 16,
    preview: 'Currículo Ruby...',
  },
  en: { exists: false, language: 'en' },
  'php-pt-br': { exists: false, language: 'pt-br' },
  'php-en': { exists: false, language: 'en' },
};

const profiles: Profile[] = [
  {
    stack: 'ruby',
    language: 'pt-br',
    content: {
      rawText: 'Currículo Ruby',
      rawLength: 14,
      sourceFile: 'curriculo_base_pt_br.html',
      extractedAt: '2026-10-20T12:00:00.000Z',
    },
    updatedAt: '2026-10-20T12:00:00.000Z',
  },
];

const theme: PdfTheme = {
  ruby: { accent: '#B56A6A', accentDark: '#9E4A4A' },
  php: { accent: '#4F5B93', accentDark: '#3F4A7A' },
  cssVersion: 'b1',
};

const candidate: CandidateData = {
  fullName: 'Horecio Dias',
  email: 'horecio@example.com',
  phone: '',
  linkedin: '',
  github: '',
};

function stubApi() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'PUT' && url.startsWith('/api/profiles/')) {
        const body = JSON.parse(String(init?.body)) as { content: Profile['content'] };
        return jsonResponse({
          stack: 'ruby',
          language: 'pt-br',
          content: body.content,
          updatedAt: '2026-11-05T00:00:00.000Z',
        });
      }
      if (method === 'PUT' && url.startsWith('/api/pdf-theme')) {
        return jsonResponse({ success: true, theme: JSON.parse(String(init?.body)) });
      }
      if (method === 'PUT' && url.startsWith('/api/candidate-data')) {
        return jsonResponse({
          success: true,
          candidate: JSON.parse(String(init?.body)),
        });
      }

      if (url.startsWith('/api/base-resumes')) return jsonResponse(baseResumes);
      if (url.startsWith('/api/profiles')) return jsonResponse(profiles);
      if (url.startsWith('/api/pdf-theme')) {
        return jsonResponse({ success: true, theme });
      }
      if (url.startsWith('/api/candidate-data')) {
        return jsonResponse({ success: true, candidate });
      }
      if (url.startsWith('/api/stats')) {
        return jsonResponse({
          total: 0,
          byStatus: {},
          averageFitRating: null,
          appliedLast30Days: 0,
        });
      }
      if (url.startsWith('/api/jobs')) return jsonResponse({ items: [], total: 0 });

      throw new Error(`URL inesperada: ${method} ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Admin', () => {
  it('mostra os quatro currículos base e carrega o texto salvo', async () => {
    stubApi();
    renderWithProviders(<App />, ['/admin']);

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(await screen.findByText('Ruby (PT-BR)')).toBeInTheDocument();
    expect(screen.getByText('Ruby (English)')).toBeInTheDocument();
    expect(screen.getByText('PHP (PT-BR)')).toBeInTheDocument();
    expect(screen.getByText('PHP (English)')).toBeInTheDocument();

    expect(screen.getByText('Enviado')).toBeInTheDocument();
    expect(screen.getAllByText('Não enviado')).toHaveLength(3);

    const textareas = screen.getAllByLabelText('Texto do currículo base');
    expect(textareas[0]).toHaveValue('Currículo Ruby');
  });

  it('salva o texto do currículo base via PUT', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />, ['/admin']);

    const textareas = await screen.findAllByLabelText('Texto do currículo base');
    await user.clear(textareas[0]);
    await user.type(textareas[0], 'Novo currículo');
    await user.click(screen.getAllByRole('button', { name: 'Salvar texto' })[0]);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/profiles/ruby/pt-br') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.content.rawText).toBe('Novo currículo');
      expect(body.content.rawLength).toBe(14);
      expect(body.content.sourceFile).toBe('curriculo_base_pt_br.html');
    });
  });

  it('salva as cores da faixa do PDF', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />, ['/admin']);

    const rubyColor = await screen.findByLabelText('Cor da faixa Ruby');
    fireEvent.change(rubyColor, { target: { value: '#112233' } });
    await user.click(screen.getByRole('button', { name: 'Salvar cores' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/pdf-theme') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.ruby.accent).toBe('#112233');
    });
  });

  it('salva os dados do formulário', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<App />, ['/admin']);

    const name = await screen.findByLabelText('Nome completo');
    expect(name).toHaveValue('Horecio Dias');
    await user.clear(name);
    await user.type(name, 'Horecio Araujo');
    await user.click(screen.getByRole('button', { name: 'Salvar dados' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/candidate-data') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.fullName).toBe('Horecio Araujo');
    });
  });
});
