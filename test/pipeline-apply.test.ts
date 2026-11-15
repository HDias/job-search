import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import type {
  ApplyBrowser,
  ApplyPage,
} from '../src/pipeline/apply/assistant.js';
import {
  buildQuestionsResult,
  categorizeQuestion,
  detectAtsPlatform,
  scrapeApplicationQuestions,
  splitFields,
  standardFieldId,
  type FormControl,
} from '../src/pipeline/apply/questions.js';
import { createPipelineService } from '../src/pipeline/service.js';
import { createTestStore } from './helpers.js';

/**
 * Application-question extraction (T5.7). The browser is always injected, so
 * the suite never launches Chromium.
 */

const CONTROLS: FormControl[] = [
  { id: 'first_name', label: 'First Name', type: 'text', required: true, options: null, name: 'first_name' },
  { id: 'email', label: 'Email', type: 'email', required: true, options: null, name: 'email' },
  { id: 'resume', label: 'Resume/CV', type: 'file', required: true, options: null, name: 'resume' },
  { id: 'linkedin', label: 'LinkedIn Profile', type: 'text', required: false, options: null, name: 'urls[LinkedIn]' },
  { id: 'q_years', label: 'How many years of Rails experience?', type: 'select', required: true, options: ['1-3', '3-5'], name: 'question_1' },
  { id: 'q_visa', label: 'Are you authorized to work in the US?', type: 'select', required: true, options: ['Yes', 'No'], name: 'question_2' },
  { id: 'q_gender', label: 'Gender', type: 'select', required: false, options: ['Male', 'Female'], name: 'question_3' },
  { id: 'dup', label: 'Email', type: 'email', required: true, options: null, name: 'email' },
  { id: 'search-input', label: 'Search', type: 'text', required: false, options: null, name: '' },
  { id: 'noise', label: 'Yes', type: 'checkbox', required: false, options: null, name: 'question_1_option' },
];

function pageStub(overrides: Partial<ApplyPage> = {}): ApplyPage {
  const element = (value: string) => ({
    isVisible: async () => true,
    fill: async (next: string) => {
      value = next;
    },
    setInputFiles: async () => undefined,
  });

  return {
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async <T>() => ({ text: 'Enviar candidatura', visible: true }) as T,
    $: async () => element(''),
    $$: async () => [element('')],
    screenshot: async () => undefined,
    ...overrides,
  } as ApplyPage;
}

function browserStub(page: ApplyPage): ApplyBrowser {
  return {
    newContext: async () => ({ newPage: async () => page }),
  };
}

describe('questions helpers', () => {
  it('detects the ATS platform from the URL', () => {
    expect(detectAtsPlatform('https://boards.greenhouse.io/acme')).toBe('greenhouse');
    expect(detectAtsPlatform('https://jobs.lever.co/acme')).toBe('lever');
    expect(detectAtsPlatform('https://apply.workable.com/acme')).toBe('workable');
    expect(detectAtsPlatform('https://acme.com/careers/1')).toBe('generic');
  });

  it('categorizes questions without misreading LinkedIn as an upload', () => {
    expect(categorizeQuestion('Resume/CV', 'file')).toBe('upload');
    expect(categorizeQuestion('Cover Letter', 'text')).toBe('upload');
    expect(categorizeQuestion('LinkedIn Profile', 'text')).toBe('personal');
    expect(categorizeQuestion('Are you authorized to work in the US?', 'select')).toBe('legal');
    expect(categorizeQuestion('Gender', 'select')).toBe('demographic');
    expect(categorizeQuestion('How many years of Rails experience?', 'select')).toBe('custom');
  });

  it('maps standard fields by name, id or label', () => {
    expect(standardFieldId({ ...CONTROLS[0]!, label: '', id: '', name: 'job_application[first_name]' })).toBe('first_name');
    expect(standardFieldId(CONTROLS[2]!)).toBe('resume');
    expect(standardFieldId(CONTROLS[3]!)).toBe('linkedin');
    expect(standardFieldId(CONTROLS[4]!)).toBeNull();
  });

  it('deduplicates, drops noise and splits standard fields from questions', () => {
    const { questions, standardFields } = splitFields(CONTROLS);

    expect(standardFields.map((field) => field.id)).toEqual([
      'first_name',
      'email',
      'resume',
      'linkedin',
    ]);
    expect(questions.map((question) => question.label)).toEqual([
      'How many years of Rails experience?',
      'Are you authorized to work in the US?',
      'Gender',
    ]);
    expect(questions.map((question) => question.category)).toEqual([
      'custom',
      'legal',
      'demographic',
    ]);
  });

  it('builds the v1 result envelope', () => {
    const result = buildQuestionsResult({
      url: 'https://boards.greenhouse.io/acme',
      platform: 'greenhouse',
      controls: CONTROLS,
      scrapedAt: '2026-11-15T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      applicationUrl: 'https://boards.greenhouse.io/acme',
      scrapedAt: '2026-11-15T00:00:00.000Z',
      platform: 'greenhouse',
    });
    expect(result.standardFields).toHaveLength(4);
    expect(result.questions).toHaveLength(3);
  });

  it('writes application_questions.json next to the artifacts', async () => {
    const dir = fs.mkdtempSync(path.join('/tmp', 'questions-test-'));
    try {
      const page = pageStub({
        evaluate: async <T>() => CONTROLS as T,
      });

      const result = await scrapeApplicationQuestions({
        url: 'https://jobs.lever.co/acme/1',
        outputDir: dir,
        browser: browserStub(page),
        wait: async () => undefined,
      });

      expect(result.platform).toBe('lever');
      const saved = JSON.parse(
        fs.readFileSync(path.join(dir, 'application_questions.json'), 'utf8'),
      ) as { platform: string; questions: unknown[] };
      expect(saved.platform).toBe('lever');
      expect(saved.questions).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------- routes -------------------------------- */

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let browser: ApplyBrowser;

function makeApp(page: ApplyPage) {
  browser = browserStub(page);
  const pipeline = createPipelineService({
    store: ctx.store,
    skillsDir: 'skills',
    browser: browser as never,
    applicationsDir: path.join(ctx.dir, 'applications'),
  });
  return createApp({
    store: ctx.store,
    pipeline,
    applicationsDir: path.join(ctx.dir, 'applications'),
  });
}

function seedJob() {
  const job = ctx.store.jobs.create({
    company: 'Acme',
    role: 'Rails Engineer',
    vacancyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
    applyUrl: 'https://boards.greenhouse.io/acme/jobs/1/apply',
    stack: 'ruby',
    language: 'en',
  });

  const folder = path.join(ctx.dir, 'applications', 'acme_rails_engineer');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'curriculo.pdf'), '%PDF');
  ctx.store.artifacts.addMany([
    {
      jobId: job.id,
      kind: 'cv_pdf',
      relativePath: 'acme_rails_engineer/curriculo.pdf',
      mime: 'application/pdf',
    },
  ]);

  return job;
}

beforeEach(() => {
  ctx = createTestStore();
  app = makeApp(pageStub());
});

afterEach(() => {
  ctx.cleanup();
});


describe('POST /api/jobs/:id/questions', () => {
  it('writes application_questions.json and returns the categories', async () => {
    const job = seedJob();
    app = makeApp(
      pageStub({ evaluate: async <T>() => CONTROLS as T }),
    );

    const response = await request(app)
      .post(`/api/jobs/${job.id}/questions`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.platform).toBe('greenhouse');
    expect(response.body.questions).toHaveLength(3);
    expect(response.body.standardFields).toHaveLength(4);
    expect(response.body.questionsUrl).toBe(
      '/applications/acme_rails_engineer/application_questions.json',
    );

    const saved = JSON.parse(
      fs.readFileSync(
        path.join(
          ctx.dir,
          'applications',
          'acme_rails_engineer',
          'application_questions.json',
        ),
        'utf8',
      ),
    ) as { questions: Array<{ category: string }> };
    expect(saved.questions.map((question) => question.category)).toEqual([
      'custom',
      'legal',
      'demographic',
    ]);
  });

  it('404 for an unknown job and 400 without a URL', async () => {
    const missing = await request(app)
      .post('/api/jobs/app_missing/questions')
      .send({});
    expect(missing.status).toBe(404);

    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Dev',
      language: 'en',
      stack: 'ruby',
    });
    const withoutUrl = await request(app)
      .post(`/api/jobs/${job.id}/questions`)
      .send({});
    expect(withoutUrl.status).toBe(400);
    expect(withoutUrl.body.error).toMatch(/URL/i);
  });
});
