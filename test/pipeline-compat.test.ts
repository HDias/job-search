import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Fit } from '../src/domain/job.js';
import type { LlmQuestion } from '../src/domain/run.js';
import type { PdfRenderer } from '../src/pipeline/kit/artifacts.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { createPipelineService } from '../src/pipeline/service.js';
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

const QUESTION: LlmQuestion = {
  question: 'Which Rails version did you use?',
  options: ['7', '8'],
  blockingField: 'rails_version',
  kind: 'missing_fact',
  inferences: [],
  rawExcerpt: '',
};

const dirs: string[] = [];
let ctx: ReturnType<typeof createTestStore>;

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-compat-'));
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

const renderPdf: PdfRenderer = async (_html, pdfPath) => {
  fs.writeFileSync(pdfPath, '%PDF-1.4 fake');
  return { atsCompatible: true };
};

function buildApp(llm: LlmClient) {
  const pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: SKILLS_DIR,
    llm,
    applicationsDir: tmpDir(),
    renderPdf,
  });
  const app = createApp({ store: ctx.store, pipeline, skillsDir: SKILLS_DIR });
  return { app, pipeline };
}

function seedWaitingRun() {
  return ctx.store.runs.create({
    stage: 'needs_input',
    url: 'https://example.com/jobs/1',
    stack: 'ruby',
    languagePreference: 'en',
    detectedLanguage: 'en',
    suggestedLanguage: 'en',
    needsInputRounds: 1,
    llmQuestion: QUESTION,
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

describe('/api/processes/:id compat shims', () => {
  it('GET question returns the v1 shape from the same run', async () => {
    const { app } = buildApp(llmStub([]));
    const run = seedWaitingRun();

    const response = await request(app).get(`/api/processes/${run.id}/question`);

    expect(response.status).toBe(200);
    expect(response.body.processId).toBe(run.id);
    expect(response.body.question.question).toContain('Rails version');
    expect(response.body.needsInputRounds).toBe(1);
  });

  it('POST respond answers the same run and returns a v1-shaped success', async () => {
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm);
    const run = seedWaitingRun();

    const response = await request(app)
      .post(`/api/processes/${run.id}/respond`)
      .send({ answer: 'Rails 7.1', approvedInferences: [], rejectedInferences: [] });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.processId).toBe(run.id);
    expect(response.body.runId).toBe(run.id);

    const whileQueued = ctx.store.runs.get(run.id);
    expect(whileQueued?.clarificationHistory?.[0].answer).toBe('Rails 7.1');

    await pipeline.queue.idle();
    expect(ctx.store.runs.get(run.id)?.stage).toBe('done');
    expect(llm.calls).toBe(1);
  });

  it('POST respond maps the v2 errors to the v1 messages', async () => {
    const { app } = buildApp(llmStub([]));
    const run = seedWaitingRun();

    const empty = await request(app)
      .post(`/api/processes/${run.id}/respond`)
      .send({ answer: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/vazia/i);

    const notWaiting = await request(app)
      .post('/api/processes/proc_missing/respond')
      .send({ answer: 'x' });
    expect(notWaiting.status).toBe(404);
  });

  it('PATCH writes the same run fields as PUT', async () => {
    const { app } = buildApp(llmStub([]));
    const run = ctx.store.runs.create({ stage: 'queued' });

    const response = await request(app)
      .patch(`/api/processes/${run.id}`)
      .send({
        stage: 'needs_input',
        languagePreference: 'en',
        detectedLanguage: 'en',
        needsInputRounds: 1,
        llmQuestion: QUESTION,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const stored = ctx.store.runs.get(run.id);
    expect(stored).toMatchObject({
      stage: 'needs_input',
      languagePreference: 'en',
      detectedLanguage: 'en',
      needsInputRounds: 1,
    });
    expect(stored?.llmQuestion?.question).toContain('Rails version');
  });
});
