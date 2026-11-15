import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Fit } from '../src/domain/job.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import type { PdfRenderer } from '../src/pipeline/kit/artifacts.js';
import { createPipelineService } from '../src/pipeline/service.js';
import type { ClarificationEntry, LlmQuestion } from '../src/domain/run.js';
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

const MISSING_FACT: LlmQuestion = {
  question: 'Which Rails version did you use?',
  options: ['7', '8'],
  blockingField: 'rails_version',
  kind: 'missing_fact',
  inferences: [],
  rawExcerpt: '',
};

const INFERENCE_APPROVAL: LlmQuestion = {
  question: 'Can I list AWS on the resume?',
  options: [],
  blockingField: 'cloud',
  kind: 'inference_approval',
  inferences: [{ skill: 'AWS', inferredFrom: 'cloud', confidence: 'high' }],
  rawExcerpt: '',
};

const dirs: string[] = [];
let ctx: ReturnType<typeof createTestStore>;

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-question-'));
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

function llmStub(responses: string[]): LlmClient & {
  calls: number;
  prompts: string[];
} {
  const stub = {
    calls: 0,
    prompts: [] as string[],
    async call(prompt: string) {
      stub.calls += 1;
      stub.prompts.push(prompt);
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

function buildApp(llm: LlmClient, applicationsDir: string) {
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

function seedWaitingRun(question: LlmQuestion, extra: Record<string, unknown> = {}) {
  return ctx.store.runs.create({
    stage: 'needs_input',
    url: 'https://example.com/jobs/1',
    stack: 'ruby',
    languagePreference: 'en',
    detectedLanguage: 'en',
    suggestedLanguage: 'en',
    needsInputRounds: 1,
    llmQuestion: question,
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
    ...extra,
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

describe('GET /api/runs/:id/question', () => {
  it('returns 404 for an unknown run', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const response = await request(app).get('/api/runs/proc_missing/question');
    expect(response.status).toBe(404);
  });

  it('returns 404 when the run is not waiting for input', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const run = seedWaitingRun(MISSING_FACT, { stage: 'done', llmQuestion: null });
    const response = await request(app).get(`/api/runs/${run.id}/question`);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/pendente/i);
  });

  it('returns the pending question with the round count', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const run = seedWaitingRun(MISSING_FACT);
    const response = await request(app).get(`/api/runs/${run.id}/question`);

    expect(response.status).toBe(200);
    expect(response.body.processId).toBe(run.id);
    expect(response.body.question.question).toContain('Rails version');
    expect(response.body.question.options).toEqual(['7', '8']);
    expect(response.body.needsInputRounds).toBe(1);
  });
});

describe('POST /api/runs/:id/respond', () => {
  it('returns 404 for an unknown run', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const response = await request(app)
      .post('/api/runs/proc_missing/respond')
      .send({ answer: 'Rails 7' });
    expect(response.status).toBe(404);
  });

  it('returns 409 when the run is not waiting for input', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const run = seedWaitingRun(MISSING_FACT, { stage: 'done', llmQuestion: null });
    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: 'Rails 7' });
    expect(response.status).toBe(409);
  });

  it('returns 400 for an empty missing_fact answer', async () => {
    const { app, pipeline } = buildApp(llmStub([]), tmpDir());
    const run = seedWaitingRun(MISSING_FACT);
    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/vazia/i);
    await pipeline.queue.idle();
    expect(ctx.store.runs.get(run.id)?.stage).toBe('needs_input');
  });

  it('returns 400 when approving an inference the LLM did not offer', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const run = seedWaitingRun(INFERENCE_APPROVAL);
    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ approvedInferences: ['Kubernetes'] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Kubernetes/);
  });

  it('accepts an offered inference approval without a free-text answer', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, applicationsDir);
    const run = seedWaitingRun(INFERENCE_APPROVAL);

    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ approvedInferences: ['AWS'] });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('done');
    expect(stored?.clarificationHistory).toHaveLength(1);
    expect(stored?.clarificationHistory?.[0].approvedInferences).toEqual(['AWS']);
    expect(llm.calls).toBe(1);
    expect(llm.prompts[0]).toContain('USER_APPROVED_INFERENCES');
    expect(llm.prompts[0]).toContain('AWS');
  });

  it('answers, resumes the same run and keeps the state', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, applicationsDir);
    const run = seedWaitingRun(MISSING_FACT);

    const response = await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: 'Rails 7.1', coverLetterGuidance: 'Emphasise the upgrade.' });

    expect(response.status).toBe(202);
    expect(response.body.runId).toBe(run.id);
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('done');
    expect(stored?.jobId).toBeTruthy();
    expect(stored?.llmQuestion).toBeNull();
    expect(stored?.clarificationHistory).toHaveLength(1);
    expect(stored?.clarificationHistory?.[0]).toMatchObject({
      answer: 'Rails 7.1',
      approvedInferences: [],
      rejectedInferences: [],
    });
    expect(stored?.coverLetterGuidance).toBe('Emphasise the upgrade.');
    expect(llm.prompts[0]).toContain('Rails 7.1');
  });

  it('keeps only the last two history entries and caps the answer at 2000 chars', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, applicationsDir);
    const history: ClarificationEntry[] = [
      {
        answer: 'first',
        approvedInferences: [],
        rejectedInferences: [],
        at: '2026-11-01T00:00:00.000Z',
      },
      {
        answer: 'second',
        approvedInferences: [],
        rejectedInferences: [],
        at: '2026-11-02T00:00:00.000Z',
      },
    ];
    const run = seedWaitingRun(MISSING_FACT, {
      clarificationHistory: history,
      needsInputRounds: 2,
    });

    await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: 'x'.repeat(3000) });
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.clarificationHistory).toHaveLength(2);
    expect(stored?.clarificationHistory?.[0].answer).toBe('second');
    expect(stored?.clarificationHistory?.[1].answer).toHaveLength(2000);
    // Combined prompt answer keeps both entries, truncated to 2000 chars.
    expect(llm.prompts[0]).toContain('second');
  });

  it('returns a pending question again when the LLM asks for another round', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([
      JSON.stringify({
        needsInput: true,
        question: 'And the PostgreSQL version?',
        blockingField: 'pg_version',
        kind: 'missing_fact',
      }),
    ]);
    const { app, pipeline } = buildApp(llm, applicationsDir);
    const run = seedWaitingRun(MISSING_FACT);

    await request(app)
      .post(`/api/runs/${run.id}/respond`)
      .send({ answer: 'Rails 7.1' });
    await pipeline.queue.idle();

    const stored = ctx.store.runs.get(run.id);
    expect(stored?.stage).toBe('needs_input');
    expect(stored?.needsInputRounds).toBe(2);
    expect(stored?.llmQuestion?.question).toContain('PostgreSQL version');
  });
});
