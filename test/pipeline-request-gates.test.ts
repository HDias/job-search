import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Fit } from '../src/domain/job.js';
import type { LlmQuestion } from '../src/domain/run.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { createPipelineService } from '../src/pipeline/service.js';
import { createTestStore } from './helpers.js';

/**
 * Gate matrix for the Phase-4 endpoints: every 409/400 path is exercised as a
 * request and must answer before the queue (the LLM stub would throw if the
 * runner were reached). Full happy paths live in `pipeline-generate-kit`,
 * `pipeline-question`, `pipeline-regenerate` and `pipeline-compat`.
 */

const SKILLS_DIR = 'skills';

const FIT: Fit = {
  rating: 85,
  analysis: 'Strong.',
  strengths: [],
  gaps: [],
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
};

const QUESTION: LlmQuestion = {
  question: 'Which Rails version?',
  options: [],
  blockingField: 'rails_version',
  kind: 'missing_fact',
  inferences: [],
  rawExcerpt: '',
};

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;

function neverCalledLlm(): LlmClient & { calls: number } {
  const stub = {
    calls: 0,
    async call() {
      stub.calls += 1;
      throw new Error('LLM must not be called on a gate');
    },
  };
  return stub;
}

beforeEach(() => {
  ctx = createTestStore();
  const pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: SKILLS_DIR,
    llm: neverCalledLlm(),
    applicationsDir: ctx.dir,
  });
  app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
});

afterEach(() => {
  ctx.cleanup();
});

describe('generate-kit request gates', () => {
  it('409 without an explicit language', async () => {
    const run = ctx.store.runs.create({ stage: 'fit-checked', fit: FIT });
    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id });
    expect(response.status).toBe(409);
    expect(response.body.needsLanguageConfirmation).toBe(true);
  });

  it('409 for low fit without confirmation', async () => {
    const run = ctx.store.runs.create({
      stage: 'fit-checked',
      languagePreference: 'en',
      fit: { ...FIT, rating: 10 },
    });
    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    expect(response.status).toBe(409);
    expect(response.body.needsFitConfirmation).toBe(true);
  });

  it('409 for failed eligibility without confirmation', async () => {
    const run = ctx.store.runs.create({
      stage: 'fit-checked',
      languagePreference: 'en',
      fit: { ...FIT, eligibility: { passed: false, reason: 'Visa' } },
    });
    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    expect(response.status).toBe(409);
    expect(response.body.eligibilityBlocked).toBe(true);
  });

  it('409 for an explicit posting language conflict', async () => {
    const run = ctx.store.runs.create({
      stage: 'fit-checked',
      languagePreference: 'pt-br',
      fit: FIT,
      jobSnapshot: {
        content: 'Please submit your resume in English.',
        detectedLanguage: 'en',
      },
    });
    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'pt-br' });
    expect(response.status).toBe(409);
    expect(response.body.jobRequiredLanguage).toBe('en');
  });

  it('400 for a body without process, URL or text', async () => {
    const response = await request(app).post('/api/generate-kit').send({});
    expect(response.status).toBe(400);
  });
});

describe('question/respond request gates', () => {
  it('404 for an unknown run and for a run with no pending question', async () => {
    expect((await request(app).get('/api/runs/proc_missing/question')).status).toBe(404);

    const done = ctx.store.runs.create({ stage: 'done' });
    expect((await request(app).get(`/api/runs/${done.id}/question`)).status).toBe(404);
  });

  it('404/409 for respond on an unknown or non-waiting run', async () => {
    expect(
      (
        await request(app)
          .post('/api/runs/proc_missing/respond')
          .send({ answer: 'x' })
      ).status,
    ).toBe(404);

    const done = ctx.store.runs.create({ stage: 'done' });
    expect(
      (
        await request(app)
          .post(`/api/runs/${done.id}/respond`)
          .send({ answer: 'x' })
      ).status,
    ).toBe(409);
  });

  it('400 for an empty missing_fact answer', async () => {
    const run = ctx.store.runs.create({
      stage: 'needs_input',
      llmQuestion: QUESTION,
    });
    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: '  ' });
    expect(response.status).toBe(400);
  });

  it('400 when approving an inference the question did not offer', async () => {
    const run = ctx.store.runs.create({
      stage: 'needs_input',
      llmQuestion: {
        question: 'List AWS?',
        options: [],
        blockingField: 'cloud',
        kind: 'inference_approval',
        inferences: [{ skill: 'AWS', inferredFrom: 'cloud', confidence: 'high' }],
        rawExcerpt: '',
      },
    });
    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ approvedInferences: ['Kubernetes'] });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Kubernetes/);
  });
});

describe('regenerate request gates', () => {
  it('404 for an unknown job', async () => {
    const response = await request(app).post('/api/jobs/job_missing/regenerate').send({});
    expect(response.status).toBe(404);
  });

  it('400 without a snapshot or pasted text', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Engineer',
      language: 'en',
      stack: 'ruby',
    });
    const response = await request(app).post(`/api/jobs/${job.id}/regenerate`).send({});
    expect(response.status).toBe(400);
  });

  it('409 on a language conflict', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Engineer',
      language: 'en',
      stack: 'ruby',
      fit: FIT,
    });
    ctx.store.runs.create({
      jobId: job.id,
      stage: 'done',
      fit: FIT,
      jobSnapshot: { content: 'A real posting with enough text.' },
    });
    const response = await request(app)
      .post(`/api/jobs/${job.id}/regenerate`)
      .send({ languagePreference: 'pt-br' });
    expect(response.status).toBe(409);
    expect(response.body.providedLanguage).toBe('pt-br');
  });
});
