import { describe, expect, it } from 'vitest';
import {
  createLlmClient,
  isRetryableError,
  LlmError,
  type LlmFetch,
  type LlmResponseLike,
} from '../src/pipeline/llm/client.js';
import type { LlmConfig } from '../src/domain/llm.js';

function response(status: number, body: unknown): LlmResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body as Record<string, unknown>,
  };
}

function baseConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: 'gemini',
    apiKey: 'KEY-1234567890-abcd',
    model: 'gemini-2.5-flash',
    baseUrl: '',
    temperature: null,
    top_p: null,
    maxTokens: null,
    ...overrides,
  };
}

interface RecordedCall {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

function fakeFetch(handler: (call: RecordedCall) => LlmResponseLike): {
  fetchImpl: LlmFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    },
  };
}

describe('llm client (port of llm_client.mjs)', () => {
  it('requires an API key', async () => {
    const client = createLlmClient({ config: baseConfig({ apiKey: '' }) });
    // The message itself stays pt-BR (user-facing).
    await expect(client.call('oi')).rejects.toThrow(/Chave de API não configurada/);
  });

  it('builds the Gemini call with systemInstruction and extracts the text', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      response(200, {
        candidates: [{ content: { parts: [{ text: 'model answer' }] } }],
      }),
    );
    const client = createLlmClient({
      config: baseConfig(),
      fetchImpl,
      sleep: async () => {},
    });

    const text = await client.call('question', 'system instruction');

    expect(text).toBe('model answer');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(
      '/v1beta/models/gemini-2.5-flash:generateContent?key=KEY-1234567890-abcd',
    );
    const body = JSON.parse(calls[0]!.init.body);
    expect(body.contents[0].parts[0].text).toBe('question');
    expect(body.systemInstruction.parts[0].text).toBe('system instruction');
  });

  it('retries 429/503 with 2s/6s backoff and then returns', async () => {
    let attempt = 0;
    const { fetchImpl, calls } = fakeFetch(() => {
      attempt += 1;
      if (attempt === 1) return response(429, { error: { message: 'Too Many Requests' } });
      if (attempt === 2) return response(503, { error: { message: 'overloaded' } });
      return response(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    });
    const sleeps: number[] = [];
    const client = createLlmClient({
      config: baseConfig(),
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      warn: () => {},
    });

    await expect(client.call('p')).resolves.toBe('ok');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 6000]);
  });

  it('does not retry definitive errors (400) and keeps the message', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      response(400, { error: { message: 'API key not valid' } }),
    );
    const client = createLlmClient({
      config: baseConfig(),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(client.call('p')).rejects.toMatchObject({
      name: 'LlmError',
      status: 400,
      message: 'API key not valid',
    });
    expect(calls).toHaveLength(1);
  });

  it('applies the DeepSeek alias and sampling and uses a custom baseUrl', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      response(200, { choices: [{ message: { content: 'hello' } }] }),
    );
    const client = createLlmClient({
      config: baseConfig({
        provider: 'nvidia',
        model: 'deepseek-v4.1-flash',
        baseUrl: 'https://my-gateway.example/v1/',
      }),
      fetchImpl,
      sleep: async () => {},
    });

    const text = await client.call('p', 'sys');

    expect(text).toBe('hello');
    expect(calls[0]!.url).toBe('https://my-gateway.example/v1');
    const payload = JSON.parse(calls[0]!.init.body);
    expect(payload.model).toBe('deepseek-ai/deepseek-v4.1-flash');
    expect(payload.temperature).toBe(1);
    expect(payload.top_p).toBe(0.95);
    expect(payload.max_tokens).toBe(8192);
    expect(payload.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer KEY-1234567890-abcd');
  });

  it('joins array content (NVIDIA GPT-OSS)', async () => {
    const { fetchImpl } = fakeFetch(() =>
      response(200, {
        choices: [{ message: { content: [{ text: 'a' }, 'b', { text: 'c' }] } }],
      }),
    );
    const client = createLlmClient({
      config: baseConfig({ provider: 'openai-compatible', model: 'x-model' }),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(client.call('p')).resolves.toBe('abc');
  });

  it('uses Anthropic headers and body', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      response(200, { content: [{ text: 'anthropic-answer' }] }),
    );
    const client = createLlmClient({
      config: baseConfig({ provider: 'anthropic', model: '' }),
      fetchImpl,
      sleep: async () => {},
    });

    const text = await client.call('p', 'sys');

    expect(text).toBe('anthropic-answer');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.init.headers['x-api-key']).toBe('KEY-1234567890-abcd');
    expect(calls[0]!.init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(calls[0]!.init.body);
    expect(body.model).toBe('claude-3-5-sonnet-20241022');
    expect(body.system).toBe('sys');
    expect(body.max_tokens).toBe(4096);
  });

  it('unknown provider error is not retryable', async () => {
    const { fetchImpl } = fakeFetch(() => response(200, {}));
    const client = createLlmClient({
      config: baseConfig({ provider: 'mistral' as LlmConfig['provider'] }),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(client.call('p')).rejects.toThrow(/Provedor de IA desconhecido/);
  });

  it('classifies transient failures as retryable', () => {
    expect(isRetryableError(429, '')).toBe(true);
    expect(isRetryableError(502, '')).toBe(true);
    expect(isRetryableError(0, 'fetch failed')).toBe(true);
    expect(isRetryableError(401, 'unauthorized')).toBe(false);
  });

  it('respects maxRetries=0 (no retry)', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      response(500, { error: { message: 'boom' } }),
    );
    const client = createLlmClient({
      config: baseConfig(),
      fetchImpl,
      sleep: async () => {},
    });

    await expect(client.call('p', '', { maxRetries: 0 })).rejects.toBeInstanceOf(
      LlmError,
    );
    expect(calls).toHaveLength(1);
  });
});
