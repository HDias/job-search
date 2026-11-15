import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Fit } from '../src/domain/job.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { createPipelineService } from '../src/pipeline/service.js';
import type { PdfRenderer } from '../src/pipeline/kit/artifacts.js';
import { createTestStore } from './helpers.js';

const SKILLS_DIR = path.resolve('skills');

const BASE_RESUME = [
  'Horecio Dias',
  'horecio@example.com',
  'Senior Software Engineer.',
  'Built products for small teams and mentored developers.',
].join('\n');

const JOB_CONTENT =
  'Build reliable products for small teams. Requirements: experience shipping software.';

const VALID_RESUME_HTML = `<!DOCTYPE html><html><head><style>:root{--accent:#B56A6A}.accent{height:8px;background:#B56A6A}h2.section-title{border-top:2px solid #B56A6A}</style></head><body><div class="accent"></div><div class="resume-container"><h1 class="candidate-name">Horecio Dias</h1><div class="target-title">Senior Software Engineer</div><div class="location-line">Remote</div><div class="contact-info">horecio@example.com</div><h2 class="section-title">Summary</h2><p class="summary-text">Senior engineer shipping products for small teams.</p><h2 class="section-title">Highlights</h2><p class="skills"><strong>Backend:</strong> Ruby | <strong>Data:</strong> PostgreSQL</p><h2 class="section-title">Experience</h2><div class="job-entry"><h3 class="job-title">Senior Software Engineer - Acme</h3><div class="job-company">Acme</div><div class="job-meta">Remote</div><ul class="bullet-list"><li>Shipped products for small teams.</li></ul></div><h2 class="section-title">Education &amp; Certifications</h2><div class="edu-entry"><div class="edu-degree">Computer Science</div><div class="edu-school">University</div></div><div class="languages">English - Professional Working</div></div></body></html>`;

const KIT = {
  company: 'Acme',
  role: 'Senior Software Engineer',
  fitRating: 85,
  fitAnalysis: 'Strong technical match.',
  tailoredResumeHtml: VALID_RESUME_HTML,
  coverLetterHtml: '<!DOCTYPE html><html><body><p>Dear Acme,</p></body></html>',
  emailSubject: 'Application: Senior Software Engineer',
  emailBody: 'Hello, I am interested.',
  emailNotes: 'Sourced from the posting.',
  linkedInConnectionNote: 'Hi, quick note.',
  linkedInInMail: 'Longer message.',
};

const FIT: Fit = {
  rating: 85,
  analysis: 'Strong technical match.',
  dimensions: {
    skillsMatch: 85,
    experienceMatch: 90,
    logisticsMatch: 80,
    cultureMatch: 75,
  },
  strengths: ['Rails'],
  gaps: [],
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
  logisticsNote: null,
};

const NEEDS_INPUT = JSON.stringify({
  needsInput: true,
  question: 'Which Rails version did you use?',
  options: ['7', '8'],
  blockingField: 'rails_version',
  kind: 'missing_fact',
});

const dirs: string[] = [];
let ctx: ReturnType<typeof createTestStore>;

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-generate-kit-'));
  dirs.push(dir);
  return dir;
}

function seedProfiles(): void {
  for (const language of ['pt-br', 'en'] as const) {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language,
      enabled: true,
      content: { rawText: BASE_RESUME, rawLength: BASE_RESUME.length },
    });
  }
}

function llmStub(responses: string[]): LlmClient & { calls: number } {
  const stub = {
    calls: 0,
    async call() {
      stub.calls += 1;
      if (responses.length === 0) throw new Error('LLM stub exhausted');
      return responses.shift() as string;
    },
  };
  return stub;
}

function pdfStub(): { renderPdf: PdfRenderer; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    renderPdf: async (_htmlPath, pdfPath) => {
      calls.push(pdfPath);
      fs.writeFileSync(pdfPath, '%PDF-1.4 fake');
      return { atsCompatible: true };
    },
  };
}

function buildApp(
  llm: LlmClient,
  applicationsDir: string,
  renderPdf: PdfRenderer = pdfStub().renderPdf,
) {
  const pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: SKILLS_DIR,
    llm,
    applicationsDir,
    renderPdf,
  });
  const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
  return { app, pipeline };
}

function seedRun(overrides: Record<string, unknown> = {}) {
  return ctx.store.runs.create({
    stage: 'fit-checked',
    url: 'https://example.com/jobs/1',
    stack: 'ruby',
    languagePreference: 'auto',
    detectedLanguage: 'en',
    suggestedLanguage: 'en',
    fit: FIT,
    jobSnapshot: {
      title: 'Senior Software Engineer',
      company: 'Acme',
      location: 'Remote',
      url: 'https://example.com/jobs/1',
      applyUrl: 'https://example.com/jobs/1/apply',
      detectedLanguage: 'en',
      content: JOB_CONTENT,
      extraQuestions: '',
      recruiterMessage: '',
    },
    ...overrides,
  });
}

beforeEach(() => {
  ctx = createTestStore();
  seedProfiles();
});

afterEach(() => {
  ctx.cleanup();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('POST /api/generate-kit — gates', () => {
  it('returns 409 when the language is not explicit', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun();

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id });

    expect(response.status).toBe(409);
    expect(response.body.needsLanguageConfirmation).toBe(true);
    expect(response.body.error).toMatch(/idioma/i);
    expect(ctx.store.runs.get(run.id)?.stage).toBe('fit-checked');
  });

  it('returns 409 for a low fit (< 50) without explicit confirmation', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'en',
      fit: { ...FIT, rating: 40 },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });

    expect(response.status).toBe(409);
    expect(response.body.needsFitConfirmation).toBe(true);
    expect(response.body.fitRating).toBe(40);
    expect(response.body.error).toMatch(/40/);
  });

  it('accepts a fit of exactly 50 (boundary is < 50)', async () => {
    const { app, pipeline } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'en',
      fit: { ...FIT, rating: 50 },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();
    expect(ctx.store.runs.get(run.id)?.stage).toBe('done');
  });

  it('returns 409 when eligibility failed and the fit is unconfirmed', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'en',
      fit: {
        ...FIT,
        eligibility: { passed: false, reason: 'Visa sponsorship not available' },
      },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });

    expect(response.status).toBe(409);
    expect(response.body.needsFitConfirmation).toBe(true);
    expect(response.body.eligibilityBlocked).toBe(true);
  });

  it('proceeds when fitConfirmed is explicitly true', async () => {
    const { app, pipeline } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'en',
      fit: { ...FIT, rating: 20 },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en', fitConfirmed: true });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();
    expect(ctx.store.runs.get(run.id)?.stage).toBe('done');
  });

  it('returns 409 when the posting explicitly requires another language', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'pt-br',
      jobSnapshot: {
        title: 'Senior Software Engineer',
        company: 'Acme',
        url: 'https://example.com/jobs/1',
        detectedLanguage: 'en',
        content:
          'Please submit your resume in English. Build reliable products for small teams.',
        extraQuestions: '',
        recruiterMessage: '',
      },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'pt-br' });

    expect(response.status).toBe(409);
    expect(response.body.needsLanguageConfirmation).toBe(true);
    expect(response.body.jobRequiredLanguage).toBe('en');
    expect(response.body.providedLanguage).toBe('pt-br');
  });

  it('does not block on a mere detection divergence without an explicit requirement', async () => {
    const { app, pipeline } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const run = seedRun({
      languagePreference: 'pt-br',
      jobSnapshot: {
        title: 'Senior Software Engineer',
        company: 'Acme',
        url: 'https://example.com/jobs/1',
        detectedLanguage: 'en',
        content: JOB_CONTENT,
        extraQuestions: '',
        recruiterMessage: '',
      },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'pt-br' });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();
    expect(ctx.store.runs.get(run.id)?.stage).toBe('done');
  });
});

describe('POST /api/generate-kit — generation', () => {
  it('runs the kit to done, writes artifacts and updates the run and job', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([JSON.stringify(KIT)]);
    const { renderPdf, calls } = pdfStub();
    const pipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm,
      applicationsDir,
      renderPdf,
    });
    const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
    const run = seedRun({ languagePreference: 'en' });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });

    expect(response.status).toBe(202);
    expect(response.body.runId).toBe(run.id);

    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('done');
    expect(stored?.error).toBeNull();
    expect(stored?.jobId).toBeTruthy();
    expect(llm.calls).toBe(1);

    const job = stored?.jobId ? ctx.store.jobs.get(stored.jobId) : null;
    expect(job).toMatchObject({
      company: 'Acme',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
      fitConfirmed: true,
    });
    expect(job?.fit?.rating).toBe(85);

    const artifacts = ctx.store.artifacts.listByJob(job!.id);
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.some((item) => item.kind === 'cv_pdf')).toBe(true);
    expect(artifacts.some((item) => item.kind === 'cover_letter_pdf')).toBe(true);
    for (const artifact of artifacts) {
      expect(
        fs.existsSync(path.join(applicationsDir, artifact.relativePath)),
      ).toBe(true);
    }
    expect(calls).toHaveLength(2);
  });

  it('stores the pending question and replays it without calling the LLM', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([NEEDS_INPUT, JSON.stringify(KIT)]);
    const pipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm,
      applicationsDir,
      renderPdf: pdfStub().renderPdf,
    });
    const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
    const run = seedRun({ languagePreference: 'en' });

    const first = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    expect(first.status).toBe(202);
    await pipeline.queue.idle();

    const pending = ctx.store.runs.get(run.id);
    expect(pending?.stage).toBe('needs_input');
    expect(pending?.needsInputRounds).toBe(1);
    expect(pending?.llmQuestion?.question).toContain('Rails version');
    expect(llm.calls).toBe(1);

    const replay = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id });
    expect(replay.status).toBe(202);
    await pipeline.queue.idle();

    const replayed = ctx.store.runs.get(run.id);
    expect(replayed?.stage).toBe('needs_input');
    expect(replayed?.llmQuestion?.question).toContain('Rails version');
    expect(llm.calls).toBe(1);

    const resumed = await request(app)
      .post('/api/generate-kit')
      .send({
        processId: run.id,
        language: 'en',
        userAnswer: 'Rails 7.1',
      });
    expect(resumed.status).toBe(202);
    await pipeline.queue.idle();

    const done = ctx.store.runs.get(run.id);
    expect(done?.stage).toBe('done');
    expect(done?.llmQuestion).toBeNull();
    expect(llm.calls).toBe(2);
  });

  it('fails after the fix prompts and can be resumed later', async () => {
    const applicationsDir = tmpDir();
    const broken = JSON.stringify({
      ...KIT,
      tailoredResumeHtml: '<html><body><p>No layout classes at all.</p></body></html>',
    });
    const llm = llmStub([broken, broken, broken, JSON.stringify(KIT)]);
    const pipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm,
      applicationsDir,
      renderPdf: pdfStub().renderPdf,
    });
    const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
    const run = seedRun({ languagePreference: 'en' });

    await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    await pipeline.queue.idle();

    const failed = ctx.store.runs.get(run.id);
    expect(failed?.stage).toBe('failed');
    expect(failed?.error).toContain('accent-missing');
    expect(llm.calls).toBe(3);

    const retry = await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    expect(retry.status).toBe(202);
    await pipeline.queue.idle();

    const done = ctx.store.runs.get(run.id);
    expect(done?.stage).toBe('done');
    expect(done?.error).toBeNull();
    expect(done?.jobId).toBeTruthy();
    expect(llm.calls).toBe(4);
  });

  it('rejects a third clarification round', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([NEEDS_INPUT]);
    const pipeline = createPipelineService({
      store: ctx.store,
      skillsDir: SKILLS_DIR,
      llm,
      applicationsDir,
      renderPdf: pdfStub().renderPdf,
    });
    const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
    const run = seedRun({
      languagePreference: 'en',
      stage: 'needs_input',
      needsInputRounds: 2,
      llmQuestion: {
        question: 'Still missing?',
        options: [],
        blockingField: 'x',
        kind: 'missing_fact',
        inferences: [],
        rawExcerpt: '',
      },
    });

    const response = await request(app)
      .post('/api/generate-kit')
      .send({
        processId: run.id,
        language: 'en',
        userAnswer: 'Yes, Rails 7.1',
      });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('failed');
    expect(stored?.error).toMatch(/Limite de clarificações/);
    expect(llm.calls).toBe(1);
  });

  it('fails the run when no enabled base profile exists', async () => {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'en',
      enabled: false,
      content: { rawText: BASE_RESUME, rawLength: BASE_RESUME.length },
    });
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'pt-br',
      enabled: false,
      content: { rawText: BASE_RESUME, rawLength: BASE_RESUME.length },
    });
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, tmpDir());
    const run = seedRun({ languagePreference: 'en' });

    await request(app)
      .post('/api/generate-kit')
      .send({ processId: run.id, language: 'en' });
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('failed');
    expect(stored?.error).toMatch(/currículo base/i);
    expect(llm.calls).toBe(0);
  });
});
