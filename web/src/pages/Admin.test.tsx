import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { CandidateData, PdfTheme } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

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

      if (method === 'PUT' && url.startsWith('/api/pdf-theme')) {
        return jsonResponse({ success: true, theme: JSON.parse(String(init?.body)) });
      }
      if (method === 'PUT' && url.startsWith('/api/candidate-data')) {
        return jsonResponse({
          success: true,
          candidate: JSON.parse(String(init?.body)),
        });
      }

      if (url.startsWith('/api/pdf-theme')) {
        return jsonResponse({ success: true, theme });
      }
      if (url.startsWith('/api/candidate-data')) {
        return jsonResponse({ success: true, candidate });
      }

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
  it('aponta para App Settings no lugar dos currículos base', async () => {
    stubApi();
    renderWithProviders(<App />, ['/admin']);

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(
      screen.getByText(/As combinações stack × idioma, o currículo base/),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Abrir App Settings' });
    expect(link).toHaveAttribute('href', '/admin/settings');
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
