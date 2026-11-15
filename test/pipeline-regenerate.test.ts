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

const OLD_FOLDER = 'acme_senior_software_engineer';
const QUESTIONS = JSON.stringify({
  platform: 'manual',
  questions: [
    { id: 'q1', label: 'Why do you want this role?' },
    { id: 'q2', label: 'What is your timezone?' },
  ],
  standardFields: [],
});
const SUGGESTIONS_MD = '# Suggestions\n';
const SUGGESTIONS_JSON = JSON.stringify({ fieldMappings: {} });
const RECRUITER = 'Hi, are you available for a chat?';

const dirs: string[] = [];
let ctx: ReturnType<typeof createTestStore>;

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-regenerate-'));
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

function writeOldFolder(applicationsDir: string): void {
  const dir = path.join(applicationsDir, OLD_FOLDER);
  fs.mkdirSync(path.join(dir, 'materiais_extras'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'application_questions.json'), QUESTIONS);
  fs.writeFileSync(path.join(dir, 'materiais_extras', 'sugestoes_respostas.json'), SUGGESTIONS_JSON);
  fs.writeFileSync(path.join(dir, 'materiais_extras', 'sugestoes_respostas.md'), SUGGESTIONS_MD);
  fs.writeFileSync(path.join(dir, 'mensagem_recrutador_origem.txt'), RECRUITER);
  fs.writeFileSync(path.join(dir, 'curriculo_direcionado.html'), '<html>old</html>');
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

describe('POST /api/jobs/:id/regenerate', () => {
  it('returns 404 for an unknown job', async () => {
    const { app } = buildApp(llmStub([]), tmpDir());
    const response = await request(app).post('/api/jobs/job_missing/regenerate').send({});
    expect(response.status).toBe(404);
  });

  it('returns 409 when the requested language conflicts with the posting', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
      fit: FIT,
    });
    ctx.store.runs.create({
      jobId: job.id,
      stage: 'done',
      stack: 'ruby',
      languagePreference: 'en',
      fit: FIT,
      jobSnapshot: { content: JOB_CONTENT, detectedLanguage: 'en' },
    });

    const response = await request(app)
      .post(`/api/jobs/${job.id}/regenerate`)
      .send({ languagePreference: 'pt-br' });

    expect(response.status).toBe(409);
    expect(response.body.needsLanguageConfirmation).toBe(true);
    expect(response.body.jobRequiredLanguage).toBe('en');
  });

  it('returns 400 when there is no snapshot and no pasted text', async () => {
    const { app } = buildApp(llmStub([JSON.stringify(KIT)]), tmpDir());
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
    });

    const response = await request(app)
      .post(`/api/jobs/${job.id}/regenerate`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/texto|vaga/i);
  });

  it('preserves the job identity and carries the old extras into the new folder', async () => {
    const applicationsDir = tmpDir();
    writeOldFolder(applicationsDir);
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, applicationsDir);

    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Senior Software Engineer',
      language: 'pt-br',
      stack: 'ruby',
      status: 'applied',
      appliedAt: '2026-11-01T12:00:00.000Z',
      fit: FIT,
      fitConfirmed: true,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    ctx.store.artifacts.addMany([
      {
        jobId: job.id,
        kind: 'cv_html',
        relativePath: `${OLD_FOLDER}/curriculo_direcionado.html`,
      },
    ]);
    ctx.store.runs.create({
      jobId: job.id,
      stage: 'done',
      stack: 'ruby',
      languagePreference: 'en',
      fit: FIT,
      jobSnapshot: {
        title: 'Senior Software Engineer',
        company: 'Acme',
        url: 'https://example.com/jobs/1',
        detectedLanguage: 'en',
        content: JOB_CONTENT,
      },
    });

    const response = await request(app)
      .post(`/api/jobs/${job.id}/regenerate`)
      .send({});

    expect(response.status).toBe(202);
    expect(response.body.runId).toMatch(/^proc_/);
    await pipeline.queue.idle();

    const preserved = ctx.store.jobs.get(job.id);
    expect(preserved).toMatchObject({
      id: job.id,
      status: 'applied',
      appliedAt: '2026-11-01T12:00:00.000Z',
      createdAt: '2026-10-01T00:00:00.000Z',
      language: 'en',
    });
    expect(preserved?.hasQuestions).toBe(true);
    expect(preserved?.hasRecruiterMessage).toBe(true);

    const artifacts = ctx.store.artifacts.listByJob(job.id);
    expect(artifacts.length).toBeGreaterThan(0);
    const newFolder = artifacts[0].relativePath.split('/')[0];
    expect(newFolder).not.toBe(OLD_FOLDER);
    expect(newFolder.startsWith(`${OLD_FOLDER}_`)).toBe(true);

    const read = (file: string): string =>
      fs.readFileSync(path.join(applicationsDir, newFolder, file), 'utf8');
    expect(read('application_questions.json')).toBe(QUESTIONS);
    expect(read('materiais_extras/sugestoes_respostas.json')).toBe(SUGGESTIONS_JSON);
    expect(read('materiais_extras/sugestoes_respostas.md')).toBe(SUGGESTIONS_MD);
    expect(read('mensagem_recrutador_origem.txt')).toBe(RECRUITER);

    const run = ctx.store.runs.get(response.body.runId);
    expect(run?.stage).toBe('done');
    expect(run?.jobId).toBe(job.id);
  });

  it('regenerates from pasted text when there is no stored snapshot', async () => {
    const applicationsDir = tmpDir();
    const llm = llmStub([JSON.stringify(KIT)]);
    const { app, pipeline } = buildApp(llm, applicationsDir);
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
      fit: FIT,
    });

    const response = await request(app)
      .post(`/api/jobs/${job.id}/regenerate`)
      .send({ rawText: JOB_CONTENT, languagePreference: 'en' });

    expect(response.status).toBe(202);
    await pipeline.queue.idle();
    expect(ctx.store.runs.get(response.body.runId)?.stage).toBe('done');
    expect(llm.calls).toBe(1);
    expect(llm.prompts[0]).toContain('Build reliable products');
  });
});
