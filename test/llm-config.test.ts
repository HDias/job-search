import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { LLM_CONFIG_KEY } from '../src/pipeline/llm/config.js';
import { createTestStore } from './helpers.js';

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let savedEnvKey: string | undefined;

beforeEach(() => {
  savedEnvKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  ctx = createTestStore();
  app = createApp({ store: ctx.store });
});

afterEach(() => {
  ctx.cleanup();
  if (savedEnvKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedEnvKey;
});

describe('GET /api/llm-config', () => {
  it('returns masked defaults when nothing was saved', async () => {
    const res = await request(app).get('/api/llm-config').expect(200);

    expect(res.body).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: '',
      temperature: '',
      top_p: '',
      maxTokens: '',
      hasKey: false,
      maskedKey: '',
    });
  });

  it('never exposes the saved key', async () => {
    await request(app)
      .put('/api/llm-config')
      .send({ apiKey: 'ZSECRET-ABCDEFGHIJ-1234' })
      .expect(200);

    const res = await request(app).get('/api/llm-config').expect(200);
    expect(res.body.hasKey).toBe(true);
    expect(res.body.maskedKey).toBe('ZSECRE...1234');
    expect(JSON.stringify(res.body)).not.toContain('ZSECRET-ABCDEFGHIJ-1234');
  });
});

describe('PUT/POST /api/llm-config', () => {
  it('saves and keeps the key when apiKey arrives empty (v1 parity)', async () => {
    // The pt-BR success message is part of the v1 contract.
    await request(app)
      .post('/api/llm-config')
      .send({ provider: 'openai', apiKey: 'sk-test-123456' })
      .expect(200, { success: true, message: 'Configuração de IA salva com sucesso!' });

    await request(app).put('/api/llm-config').send({ apiKey: '' }).expect(200);

    const res = await request(app).get('/api/llm-config');
    expect(res.body.provider).toBe('openai');
    expect(res.body.model).toBe('gpt-4o');
    expect(res.body.hasKey).toBe(true);
  });

  it('switching provider without a model falls back to the provider default', async () => {
    await request(app)
      .put('/api/llm-config')
      .send({ provider: 'openai', model: 'gpt-4o' })
      .expect(200);
    await request(app).put('/api/llm-config').send({ provider: 'anthropic' }).expect(200);

    const res = await request(app).get('/api/llm-config');
    expect(res.body.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('accepts numeric sampling and clears it with null', async () => {
    await request(app)
      .put('/api/llm-config')
      .send({ temperature: 0.7, top_p: 0.9, maxTokens: 2000 })
      .expect(200);
    let res = await request(app).get('/api/llm-config');
    expect(res.body.temperature).toBe(0.7);
    expect(res.body.top_p).toBe(0.9);
    expect(res.body.maxTokens).toBe(2000);

    await request(app).put('/api/llm-config').send({ temperature: null }).expect(200);
    res = await request(app).get('/api/llm-config');
    expect(res.body.temperature).toBe('');
  });

  it('rejects invalid provider, empty body and out-of-range temperature', async () => {
    await request(app)
      .put('/api/llm-config')
      .send({ provider: 'mistral' })
      .expect(400);
    await request(app).put('/api/llm-config').send({}).expect(400);
    await request(app).put('/api/llm-config').send({ temperature: 9 }).expect(400);
  });

  it('persists the key in settings under the internal key', async () => {
    await request(app)
      .put('/api/llm-config')
      .send({ apiKey: 'persist-key-123456' })
      .expect(200);

    const entry = ctx.store.settings.get<Record<string, unknown>>(LLM_CONFIG_KEY);
    expect(entry?.apiKey).toBe('persist-key-123456');
  });
});
