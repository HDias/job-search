import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { Profile } from '../api/types';
import { jsonResponse, renderWithProviders } from '../test/utils';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    stack: 'ruby',
    language: 'pt-br',
    content: {
      rawText: 'Currículo Ruby',
      rawLength: 14,
      sourceFile: 'curriculo_base_pt_br.html',
      extractedAt: '2026-10-20T12:00:00.000Z',
    },
    enabled: true,
    extraPrompt: null,
    updatedAt: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

function stubApi(
  initial: Profile[],
  options: {
    duplicateOnCreate?: boolean;
    uploadStatus?: number;
    uploadError?: string;
  } = {},
) {
  const profiles = [...initial];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

      if (method === 'GET' && url.startsWith('/api/profiles')) {
        // A fresh array per response: TanStack Query keeps the old reference
        // when both payloads are identical, which would hide the refetch.
        return jsonResponse([...profiles]);
      }

      if (method === 'POST' && /^\/api\/profiles\/[^/]+\/[^/]+\/upload$/.test(url)) {
        if (options.uploadStatus) {
          return jsonResponse({ error: options.uploadError }, options.uploadStatus);
        }
        const match = url.match(/^\/api\/profiles\/([^/]+)\/([^/]+)\/upload$/);
        const stack = decodeURIComponent(match?.[1] ?? '');
        const language = decodeURIComponent(match?.[2] ?? '');
        const index = profiles.findIndex(
          (profile) =>
            profile.stack === stack && profile.language === language,
        );
        const updated = {
          ...profiles[index],
          content: {
            rawText: 'Texto extraído do PDF',
            rawLength: 21,
            sourceFile: 'curriculo.pdf',
            extractedAt: '2026-11-15T00:00:00.000Z',
          },
          updatedAt: '2026-11-15T00:00:00.000Z',
        };
        profiles[index] = updated;
        return jsonResponse({
          success: true,
          message: 'Currículo base Ruby (Português) atualizado com sucesso!',
          fileName: 'curriculo.pdf',
          charCount: 21,
        });
      }

      if (method === 'POST' && url.startsWith('/api/profiles')) {
        if (options.duplicateOnCreate) {
          return jsonResponse({ error: 'Essa combinação já existe' }, 409);
        }
        const created = makeProfile({
          stack: body.stack,
          language: body.language,
          content: null,
          enabled: body.enabled ?? true,
          extraPrompt: body.extraPrompt ?? null,
        });
        profiles.push(created);
        return jsonResponse(created, 201);
      }

      const match = url.match(/^\/api\/profiles\/([^/]+)\/([^/]+)$/);
      if (match) {
        const stack = decodeURIComponent(match[1]);
        const language = decodeURIComponent(match[2]);
        const index = profiles.findIndex(
          (profile) => profile.stack === stack && profile.language === language,
        );

        if (method === 'PUT' && index >= 0) {
          const updated = {
            ...profiles[index],
            ...body,
            updatedAt: '2026-11-05T00:00:00.000Z',
          };
          profiles[index] = updated;
          return jsonResponse(updated);
        }

        if (method === 'DELETE' && index >= 0) {
          profiles.splice(index, 1);
          return jsonResponse(undefined, 204);
        }
      }

      throw new Error(`URL inesperada: ${method} ${url}`);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppSettings', () => {
  it('lista os alvos existentes', async () => {
    stubApi([
      makeProfile(),
      makeProfile({
        stack: 'php',
        language: 'en',
        content: null,
        updatedAt: '2026-10-21T12:00:00.000Z',
      }),
    ]);

    renderWithProviders(<App />, ['/admin/settings']);

    expect(await screen.findByRole('heading', { name: 'App Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'ruby (pt-br)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'php (en)' })).toBeInTheDocument();
    expect(screen.getByText('Enviado')).toBeInTheDocument();
    expect(screen.getByText('Não enviado')).toBeInTheDocument();
  });

  it('adiciona um alvo via POST', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi([]);
    renderWithProviders(<App />, ['/admin/settings']);

    const stack = await screen.findByLabelText('Stack');
    await user.type(stack, 'Elixir');
    await user.selectOptions(screen.getByLabelText('Idioma'), 'en');
    await user.click(screen.getByRole('button', { name: 'Adicionar alvo' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/profiles') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({ stack: 'elixir', language: 'en' });
    });
  });

  it('salva currículo e instruções extras em um único PUT', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi([makeProfile()]);
    renderWithProviders(<App />, ['/admin/settings']);

    const curriculum = await screen.findByLabelText('Texto do currículo base');
    await user.clear(curriculum);
    await user.type(curriculum, 'Novo currículo');

    const extra = screen.getByLabelText('Instruções extras (fit e tailor)');
    await user.type(extra, 'Priorizar APIs REST.');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

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
      expect(body.extraPrompt).toBe('Priorizar APIs REST.');
      expect(body.enabled).toBe(true);
    });
  });

  it('desativa um alvo sem perder o currículo', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi([makeProfile()]);
    renderWithProviders(<App />, ['/admin/settings']);

    const active = await screen.findByRole('checkbox');
    await user.click(active);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/profiles/ruby/pt-br') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.enabled).toBe(false);
      expect(body.content).toBeUndefined();
      expect(body.extraPrompt).toBeNull();
    });
  });

  it('remove um alvo após confirmação', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = stubApi([makeProfile()]);
    renderWithProviders(<App />, ['/admin/settings']);

    await user.click(await screen.findByRole('button', { name: 'Remover' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/profiles/ruby/pt-br') &&
          (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(call).toBeDefined();
    });
  });

  it('mostra erro de combinação duplicada (409)', async () => {
    const user = userEvent.setup();
    stubApi([], { duplicateOnCreate: true });
    renderWithProviders(<App />, ['/admin/settings']);

    await user.type(await screen.findByLabelText('Stack'), 'ruby');
    await user.click(screen.getByRole('button', { name: 'Adicionar alvo' }));

    expect(
      await screen.findByText('Essa combinação já existe.'),
    ).toBeInTheDocument();
  });
});

describe('AppSettings — base resume upload', () => {
  function uploadInput() {
    return screen.getByLabelText('Enviar currículo base');
  }

  it('uploads a PDF through the multipart endpoint', async () => {
    const fetchMock = stubApi([makeProfile()]);
    renderWithProviders(<App />, ['/admin/settings']);

    const input = await screen.findByLabelText('Enviar currículo base');
    const file = new File(['%PDF-1.7'], 'curriculo.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/profiles/ruby/pt-br/upload') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('resumeFile')).toBeInstanceOf(File);
      expect(new Headers(init.headers).has('content-type')).toBe(false);
    });

    // The refetched profile replaces the textarea content.
    await waitFor(() =>
      expect(screen.getByLabelText('Texto do currículo base')).toHaveValue(
        'Texto extraído do PDF',
      ),
    );
    expect(uploadInput()).toBeInTheDocument();
  });

  it('explains the 10 MB limit', async () => {
    stubApi([makeProfile()], {
      uploadStatus: 413,
      uploadError: 'Currículo maior que 10 MB',
    });
    renderWithProviders(<App />, ['/admin/settings']);

    const input = await screen.findByLabelText('Enviar currículo base');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'grande.pdf', { type: 'application/pdf' })] },
    });

    expect(
      await screen.findByText('O arquivo passa do limite de 10 MB.'),
    ).toBeInTheDocument();
  });

  it('explains a PDF that has no extractable text', async () => {
    stubApi([makeProfile()], {
      uploadStatus: 422,
      uploadError: 'Não foi possível extrair texto do arquivo (PDF exige pdftotext)',
    });
    renderWithProviders(<App />, ['/admin/settings']);

    const input = await screen.findByLabelText('Enviar currículo base');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'vazio.pdf', { type: 'application/pdf' })] },
    });

    expect(
      await screen.findByText(/Não foi possível extrair texto do PDF/),
    ).toBeInTheDocument();
  });

  it('still reads text files locally', async () => {
    const user = userEvent.setup();
    stubApi([makeProfile()]);
    renderWithProviders(<App />, ['/admin/settings']);

    const input = await screen.findByLabelText('Enviar currículo base');
    const file = new File(['Currículo em texto'], 'cv.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByLabelText('Texto do currículo base')).toHaveValue(
        'Currículo em texto',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(
        screen.getByText('Alvo salvo.'),
      ).toBeInTheDocument(),
    );
  });
});
