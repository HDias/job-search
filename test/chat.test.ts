import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { ChatMessage, Fit, Job } from '../src/domain/job.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { respondToChat } from '../src/pipeline/chat.js';
import { createPipelineService } from '../src/pipeline/service.js';
import { createSkillLoader } from '../src/pipeline/skills/loader.js';
import { createTestStore } from './helpers.js';

/**
 * Post-response chat (D3/D5): synchronous LLM call grounded on the scraped
 * posting and the fit analysis, with the thread persisted per job. The LLM is
 * always injected; the suite never reaches the network.
 */

const fit: Fit = {
  rating: 82,
  analysis: 'Strong Rails and PostgreSQL background.',
  dimensions: { skillsMatch: 90, experienceMatch: 80 },
  strengths: ['Rails', 'PostgreSQL'],
  gaps: ['Kubernetes'],
};

const JOB_CONTENT =
  'We are hiring a Senior Rails Engineer to build payment APIs with PostgreSQL.';

let ctx: ReturnType<typeof createTestStore>;

interface LlmStub extends LlmClient {
  calls: Array<{ prompt: string; system: string }>;
}

function llmStub(reply = 'Aderência alta, com um gap em Kubernetes.'): LlmStub {
  const calls: LlmStub['calls'] = [];
  return {
    calls,
    call: vi.fn(async (prompt: string, system = '') => {
      calls.push({ prompt, system });
      return reply;
    }),
  };
}

function seedJob(overrides: Partial<Job> = {}): Job {
  return ctx.store.jobs.create({
    company: 'Acme',
    role: 'Senior Rails Engineer',
    language: 'en',
    stack: 'ruby',
    vacancyUrl: 'https://example.com/jobs/1',
    fit,
    ...overrides,
  });
}

function seedRun(job: Job, content = JOB_CONTENT) {
  return ctx.store.runs.create({
    jobId: job.id,
    stage: 'done',
    jobSnapshot: {
      title: job.role,
      company: job.company,
      url: job.vacancyUrl ?? undefined,
      content,
    },
    fit,
  });
}

function makeApp(llm: LlmClient) {
  const pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: 'skills',
    llm,
  });
  return createApp({ store: ctx.store, pipeline });
}

beforeEach(() => {
  ctx = createTestStore();
});

afterEach(() => {
  ctx.cleanup();
});

describe('respondToChat', () => {
  const deps = () => ({
    store: ctx.store,
    loader: createSkillLoader('skills'),
  });

  it('returns not_found for an unknown job', async () => {
    const outcome = await respondToChat(
      { ...deps(), llm: llmStub() },
      'app_missing',
      'Resuma o fit.',
    );

    expect(outcome).toEqual({ status: 'not_found' });
  });

  it('returns empty_message for a blank message', async () => {
    const job = seedJob();
    seedRun(job);

    const outcome = await respondToChat(
      { ...deps(), llm: llmStub() },
      job.id,
      '   ',
    );

    expect(outcome).toEqual({ status: 'empty_message' });
  });

  it('returns no_context when there is neither a snapshot nor a fit', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Rails Engineer',
      fit: null,
    });

    const outcome = await respondToChat(
      { ...deps(), llm: llmStub() },
      job.id,
      'Resuma o fit.',
    );

    expect(outcome).toEqual({ status: 'no_context' });
  });

  it('appends user before assistant, persists the turn and calls the LLM once', async () => {
    const job = seedJob();
    seedRun(job);
    const llm = llmStub('Fit forte em Rails.');

    const outcome = await respondToChat(
      { ...deps(), llm },
      job.id,
      '  Resuma o fit.  ',
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('unreachable');

    expect(outcome.reply).toBe('Fit forte em Rails.');
    expect(outcome.chat.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(outcome.chat[0]?.content).toBe('Resuma o fit.');
    expect(outcome.chat[1]?.content).toBe('Fit forte em Rails.');
    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(ctx.store.jobs.get(job.id)?.chatHistory).toEqual(outcome.chat);
  });

  it('grounds the prompt on the posting, the fit and the prior history', async () => {
    const job = seedJob({
      chatHistory: [
        {
          role: 'user',
          content: 'Qual é o canal da candidatura?',
          at: '2026-11-14T10:00:00.000Z',
        },
        {
          role: 'assistant',
          content: 'O canal registrado é o portal.',
          at: '2026-11-14T10:00:05.000Z',
        },
      ],
    });
    seedRun(job);
    const llm = llmStub();

    await respondToChat({ ...deps(), llm }, job.id, 'E os gaps?');

    const [{ prompt, system }] = llm.calls;
    expect(system).toMatch(/ZERO LIES/i);
    expect(prompt).toContain(JOB_CONTENT);
    expect(prompt).toContain('82');
    expect(prompt).toContain('PostgreSQL');
    expect(prompt).toContain('Kubernetes');
    expect(prompt).toContain('Strong Rails and PostgreSQL background.');
    expect(prompt).toContain('Qual é o canal da candidatura?');
    expect(prompt).toContain('O canal registrado é o portal.');
    expect(prompt).toContain('E os gaps?');
  });

  it('sends only the most recent turns to the prompt but keeps the whole thread', async () => {
    const history: ChatMessage[] = Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0 ? 'oldest-turn' : `turn-${index}`,
      at: `2026-11-14T10:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const job = seedJob({ chatHistory: history });
    seedRun(job);
    const llm = llmStub();

    const outcome = await respondToChat(
      { ...deps(), llm },
      job.id,
      'next message',
    );

    const [{ prompt }] = llm.calls;
    expect(prompt).not.toContain('oldest-turn');
    expect(prompt).toContain('turn-15');
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('unreachable');
    expect(outcome.chat).toHaveLength(18);
  });

  it('never leaks an API key when the LLM fails', async () => {
    const job = seedJob();
    seedRun(job);
    const failing: LlmClient = {
      call: vi.fn(async () => {
        throw new Error('401 invalid api key sk-live-secret-123');
      }),
    };

    const error = await respondToChat(
      { ...deps(), llm: failing },
      job.id,
      'Resuma o fit.',
    ).catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Falha ao consultar a IA/);
    expect((error as Error).message).not.toContain('sk-live-secret-123');

    // Nothing is persisted when the call fails.
    expect(ctx.store.jobs.get(job.id)?.chatHistory).toEqual([]);
  });
});

describe('POST /api/jobs/:id/chat', () => {
  it('404 for an unknown job', async () => {
    const app = makeApp(llmStub());
    const response = await request(app)
      .post('/api/jobs/app_missing/chat')
      .send({ message: 'Resuma o fit.' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Vaga não encontrada');
  });

  it('400 for an empty message', async () => {
    const job = seedJob();
    seedRun(job);
    const app = makeApp(llmStub());

    const response = await request(app)
      .post(`/api/jobs/${job.id}/chat`)
      .send({ message: '   ' });

    expect(response.status).toBe(400);
  });

  it('409 without job snapshot or fit', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Rails Engineer',
      fit: null,
    });
    const app = makeApp(llmStub());

    const response = await request(app)
      .post(`/api/jobs/${job.id}/chat`)
      .send({ message: 'Resuma o fit.' });

    expect(response.status).toBe(409);
  });

  it('answers { reply, chat } and persists the thread', async () => {
    const job = seedJob();
    seedRun(job);
    const app = makeApp(llmStub('Fit forte.'));

    const response = await request(app)
      .post(`/api/jobs/${job.id}/chat`)
      .send({ message: 'Resuma o fit.' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.reply).toBe('Fit forte.');
    expect(response.body.chat.map((turn: ChatMessage) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(ctx.store.jobs.get(job.id)?.chatHistory).toHaveLength(2);
  });

  it('answers 500 without exposing the provider error or the key', async () => {
    const job = seedJob();
    seedRun(job);
    const failing: LlmClient = {
      call: vi.fn(async () => {
        throw new Error('401 invalid api key sk-live-secret-123');
      }),
    };
    const app = makeApp(failing);

    const response = await request(app)
      .post(`/api/jobs/${job.id}/chat`)
      .send({ message: 'Resuma o fit.' });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('sk-live-secret-123');
  });
});
