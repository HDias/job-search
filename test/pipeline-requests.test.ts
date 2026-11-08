import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { createPipelineService } from '../src/pipeline/service.js';
import type { ScrapedJob } from '../src/pipeline/scrape/job.js';
import { createTestStore } from './helpers.js';

const SKILLS_DIR = path.resolve('skills');

const REAL_JD = `Senior Ruby on Rails Engineer at ShipHawk.
Requirements: 5+ years with Ruby on Rails, PostgreSQL, Sidekiq, RSpec and Docker.
Experience building REST APIs in production. Responsibilities: design, code reviews,
mentoring juniors. Benefits: remote friendly, salary range, English communication. `.repeat(8);

const FIT = {
  company: 'ShipHawk',
  role: 'Senior Ruby on Rails Engineer',
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
  skillsMatch: 85,
  experienceMatch: 90,
  logisticsMatch: 80,
  cultureMatch: 75,
  fitRating: 84,
  fitAnalysis: 'Boa aderência.',
  strengths: ['Rails'],
  gaps: [],
  recommendation: 'proceed',
};

const SCRAPED: ScrapedJob = {
  url: 'https://example.com/job',
  scrapedAt: '2026-11-08T00:00:00.000Z',
  title: 'Ruby Engineer',
  company: 'Example',
  location: 'Remote',
  applyUrl: 'https://example.com/job',
  detectedLanguage: 'en',
  languageConfidence: { ptScore: 0, enScore: 6 },
  content: REAL_JD,
  via: 'playwright',
};

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let pipeline: ReturnType<typeof createPipelineService>;

function stubLlm(): LlmClient {
  return { call: async () => JSON.stringify(FIT) };
}

function seedProfiles(): void {
  for (const language of ['pt-br', 'en'] as const) {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language,
      enabled: true,
      content: { rawText: REAL_JD, rawLength: REAL_JD.length },
    });
  }
}

beforeEach(() => {
  ctx = createTestStore();
  seedProfiles();
  pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: SKILLS_DIR,
    llm: stubLlm(),
    scrape: async () => SCRAPED,
  });
  app = createApp({
    store: ctx.store,
    pipeline,
    skillsDir: SKILLS_DIR,
  });
});

afterEach(() => {
  ctx.cleanup();
});

describe('POST /api/fit-check', () => {
  it('returns 202 with a runId and persists the fit checkpoint', async () => {
    const response = await request(app)
      .post('/api/fit-check')
      .send({
        rawText: REAL_JD,
        languagePreference: 'en',
        stack: 'ruby',
      });

    expect(response.status).toBe(202);
    expect(response.body.runId).toMatch(/^proc_/);

    await pipeline.queue.idle();

    const run = await request(app).get(`/api/runs/${response.body.runId}`);
    expect(run.status).toBe(200);
    expect(run.body.stage).toBe('fit-checked');
    expect(run.body.fit.rating).toBe(84);
    expect(run.body.detectedLanguage).toBe('en');
    expect(run.body.needsLanguageConfirmation).toBe(false);
  });

  it('persists scrape-thin runs without a fit', async () => {
    const thinPipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm: stubLlm(),
      scrape: async () => ({
        ...SCRAPED,
        content: 'Please enable JavaScript to continue',
      }),
    });
    const thinApp = createApp({ store: ctx.store, pipeline: thinPipeline });

    const response = await request(thinApp)
      .post('/api/fit-check')
      .send({ url: 'https://example.com/job', stack: 'ruby' });

    expect(response.status).toBe(202);
    await thinPipeline.queue.idle();

    const run = await request(thinApp).get(`/api/runs/${response.body.runId}`);
    expect(run.body.stage).toBe('scrape-thin');
    expect(run.body.fit).toBeNull();
    expect(run.body.needsLanguageConfirmation).toBe(true);
    expect(run.body.jobSnapshot.contentThin).toBe(true);
  });

  it('records a failed run when the pipeline throws', async () => {
    const failingPipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm: { call: async () => 'not json' },
    });
    const failingApp = createApp({ store: ctx.store, pipeline: failingPipeline });

    const response = await request(failingApp)
      .post('/api/fit-check')
      .send({ rawText: REAL_JD, languagePreference: 'en', stack: 'ruby' });
    await failingPipeline.queue.idle();

    const run = await request(failingApp).get(`/api/runs/${response.body.runId}`);
    expect(run.body.stage).toBe('failed');
    expect(run.body.error).toMatch(/JSON válido/);
  });

  it('rejects bodies without url, text or snapshot', async () => {
    const response = await request(app).post('/api/fit-check').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Dados inválidos');
  });

  it('reuses a provided processId for resume', async () => {
    ctx.store.runs.create({ id: 'proc_resume', stage: 'failed', error: 'antigo' });

    const response = await request(app)
      .post('/api/fit-check')
      .send({
        processId: 'proc_resume',
        rawText: REAL_JD,
        languagePreference: 'en',
        stack: 'ruby',
      });

    expect(response.status).toBe(202);
    expect(response.body.runId).toBe('proc_resume');
    await pipeline.queue.idle();

    const run = await request(app).get('/api/runs/proc_resume');
    expect(run.body.stage).toBe('fit-checked');
    expect(run.body.error).toBeNull();
  });
});

describe('POST /api/evaluate-fit', () => {
  it('returns the deterministic hybrid breakdown', async () => {
    const response = await request(app)
      .post('/api/evaluate-fit')
      .send({ jobText: REAL_JD, stack: 'ruby' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.fitPercentage).toBeGreaterThan(0);
    expect(response.body.breakdown).toEqual(
      expect.objectContaining({
        semantic: expect.any(Number),
        temporal: expect.any(Number),
        evidence: expect.any(Number),
      }),
    );
    expect(response.body.detailedReport).toBeTruthy();
  });

  it('updates the application fit when applicationId is provided', async () => {
    ctx.store.jobs.create({
      id: 'app_fit',
      company: 'Acme',
      role: 'Ruby Engineer',
      stack: 'ruby',
    });

    const response = await request(app)
      .post('/api/evaluate-fit')
      .send({ jobText: REAL_JD, applicationId: 'app_fit' });

    expect(response.status).toBe(200);
    expect(response.body.applicationId).toBe('app_fit');

    const job = ctx.store.jobs.get('app_fit');
    expect(job?.fit?.rating).toBe(response.body.fitPercentage);
    expect(job?.fit?.dimensions?.skillsMatch).toEqual(expect.any(Number));
  });

  it('validates the body and missing profiles', async () => {
    expect(
      (await request(app).post('/api/evaluate-fit').send({ jobText: '   ' }))
        .status,
    ).toBe(400);

    const empty = createTestStore();
    try {
      const emptyApp = createApp({ store: empty.store });
      const response = await request(emptyApp)
        .post('/api/evaluate-fit')
        .send({ jobText: REAL_JD });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/currículo base/i);
    } finally {
      empty.cleanup();
    }
  });
});
