import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import {
  assistApplication,
  buildFieldPlans,
  type ApplyBrowser,
  type ApplyPage,
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
 * Dry-run prefill and application-question extraction (T5.7). The browser is
 * always injected: the suite never launches Chromium and the "never clicks
 * Submit" guarantee is asserted through a page stub that throws on click.
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

const candidate = {
  fullName: 'Horecio Dias',
  firstName: 'Horecio',
  lastName: 'Dias',
  email: 'horecio@example.com',
  phone: '+55 11 98888-7777',
  linkedin: 'https://linkedin.com/in/horecio',
  github: 'https://github.com/horecio',
};

describe('buildFieldPlans', () => {
  it('maps candidate data to the v1 selector order', () => {
    const plans = buildFieldPlans(candidate);

    expect(plans.map((plan) => plan.field)).toEqual([
      'Nome Completo',
      'Primeiro Nome',
      'Sobrenome',
      'Email',
      'Telefone',
      'LinkedIn',
      'GitHub/Portfolio',
    ]);
    expect(plans.find((plan) => plan.field === 'Email')?.value).toBe(
      'horecio@example.com',
    );
    expect(plans[0]?.selectors[0]).toContain('input[name*="name" i]');
  });

  it('splits the full name when first/last are missing', () => {
    const plans = buildFieldPlans({ fullName: 'Horecio Araujo Dias' });

    expect(plans.find((plan) => plan.field === 'Primeiro Nome')?.value).toBe(
      'Horecio',
    );
    expect(plans.find((plan) => plan.field === 'Sobrenome')?.value).toBe(
      'Araujo Dias',
    );
  });

  it('falls back to the portfolio when GitHub is missing', () => {
    const plans = buildFieldPlans({ portfolio: 'https://horecio.dev' });
    expect(plans.find((plan) => plan.field === 'GitHub/Portfolio')?.value).toBe(
      'https://horecio.dev',
    );
  });
});

describe('assistApplication', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join('/tmp', 'apply-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fills the standard fields, attaches the resume and never clicks submit', async () => {
    const filled: Array<[string, string]> = [];
    const files: string[] = [];
    const screenshots: string[] = [];

    const forbidden = () => {
      throw new Error('the dry-run must never click or submit');
    };

    const page = pageStub({
      $: async () => ({
        isVisible: async () => true,
        fill: async (value: string) => {
          filled.push(['selector', value]);
        },
        setInputFiles: async () => undefined,
      }),
      $$: async () => [
        {
          isVisible: async () => true,
          fill: async () => undefined,
          setInputFiles: async (filePath: string) => {
            files.push(filePath);
          },
        },
      ],
      screenshot: async ({ path: target }: { path: string }) => {
        screenshots.push(target);
        fs.writeFileSync(target, 'png');
      },
      click: forbidden,
      submit: forbidden,
      press: forbidden,
    } as unknown as Partial<ApplyPage>);

    const resumePath = path.join(dir, 'curriculo.pdf');
    fs.writeFileSync(resumePath, '%PDF');

    const report = await assistApplication({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      candidate,
      resumePath,
      outputDir: dir,
      browser: browserStub(page),
      wait: async () => undefined,
    });

    expect(filled.length).toBeGreaterThan(0);
    expect(filled.map(([, value]) => value)).toContain('horecio@example.com');
    expect(files).toEqual([resumePath]);

    expect(report.status).toBe('AGUARDANDO_APROVACAO_HUMANA');
    expect(report.resumeAttached).toBe(true);
    expect(report.submitButtonDetected).toEqual({
      text: 'Enviar candidatura',
      visible: true,
    });
    expect(report.notice).toMatch(/NENHUMA submissão/);
    expect(report.filledFields.some((entry) => entry.field === 'Currículo (PDF)')).toBe(
      true,
    );

    expect(screenshots[0]).toBe(path.join(dir, 'preview_before_submit.png'));
    expect(fs.existsSync(report.screenshotPath ?? '')).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, 'application_dry_run_report.json'), 'utf8'),
    ) as { status: string; filledFields: unknown[] };
    expect(saved.status).toBe('AGUARDANDO_APROVACAO_HUMANA');
    expect(saved.filledFields.length).toBe(report.filledFields.length);
  });

  it('reports exactly one filled field when only the e-mail is sent', async () => {
    const page = pageStub({
      $: async (selector: string) => ({
        isVisible: async () => true,
        fill: async (value: string) => {
          if (!selector.includes('email')) throw new Error('unexpected selector');
          expect(value).toBe('horecio@example.com');
        },
        setInputFiles: async () => undefined,
      }),
    });

    const report = await assistApplication({
      url: 'https://example.com/apply',
      candidate: { email: 'horecio@example.com' },
      resumePath: null,
      outputDir: dir,
      browser: browserStub(page),
      wait: async () => undefined,
    });

    expect(report.filledFields).toEqual([
      { field: 'Email', selector: 'input[type="email"]', value: 'horecio@example.com' },
    ]);
    expect(report.resumeAttached).toBe(false);
  });
});

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

describe('POST /api/jobs/:id/prefill', () => {
  it('returns the dry-run report with artifact URLs and never submits', async () => {
    const job = seedJob();
    const click = vi.fn(() => {
      throw new Error('must not click');
    });
    app = makeApp(pageStub({ click } as unknown as Partial<ApplyPage>));

    const response = await request(app)
      .post(`/api/jobs/${job.id}/prefill`)
      .send({ candidateData: { email: 'horecio@example.com' } });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.prefill.status).toBe('AGUARDANDO_APROVACAO_HUMANA');
    expect(response.body.prefill.resumeAttached).toBe(true);
    expect(response.body.prefill.screenshotUrl).toMatch(
      /^\/applications\/acme_rails_engineer\/preview_before_submit\.png$/,
    );
    expect(response.body.prefill.reportUrl).toMatch(
      /^\/applications\/acme_rails_engineer\/application_dry_run_report\.json$/,
    );
    expect(response.body.prefill.notice).toMatch(/NENHUMA submissão/);
    expect(click).not.toHaveBeenCalled();

    const saved = ctx.store.settings.get<{ email?: string }>('candidate_form');
    expect(saved?.email).toBe('horecio@example.com');
  });

  it('404 for an unknown job', async () => {
    const response = await request(app).post('/api/jobs/app_missing/prefill').send({});
    expect(response.status).toBe(404);
  });

  it('400 without an application URL', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Dev',
      language: 'en',
      stack: 'ruby',
    });

    const response = await request(app).post(`/api/jobs/${job.id}/prefill`).send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/URL/i);
  });

  it('400 without a CV PDF artifact', async () => {
    const job = ctx.store.jobs.create({
      company: 'Acme',
      role: 'Dev',
      language: 'en',
      stack: 'ruby',
      applyUrl: 'https://example.com/apply',
    });

    const response = await request(app).post(`/api/jobs/${job.id}/prefill`).send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/PDF/i);
  });
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
