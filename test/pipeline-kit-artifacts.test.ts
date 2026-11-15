import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KitData, KitJobData } from '../src/pipeline/kit/generate.js';
import { writeKitArtifacts } from '../src/pipeline/kit/artifacts.js';
import type { Fit } from '../src/domain/job.js';
import { createTestStore } from './helpers.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const RESUME_HTML =
  '<!DOCTYPE html><html><body><div class="accent"></div><div class="resume-container">CV</div></body></html>';
const COVER_HTML =
  '<!DOCTYPE html><html><body><p>Dear Acme,</p></body></html>';

const JOB: KitJobData = {
  title: 'Senior Software Engineer',
  company: 'Acme Corp.',
  location: 'Remote',
  url: 'https://example.com/jobs/1',
  applyUrl: 'https://example.com/jobs/1/apply',
  detectedLanguage: 'en',
  content:
    'Build products. Please submit your CV and cover letter in a single file.',
  extraQuestions: 'Why do you want this role?\nWhat is your timezone?',
  recruiterMessage: 'Hi, are you available?',
};

const KIT: KitData = {
  company: 'Acme Corp.',
  role: 'Senior Software Engineer',
  fitRating: 85,
  fitAnalysis: 'Strong match.',
  resumeHtml: RESUME_HTML,
  coverLetterHtml: COVER_HTML,
  emailSubject: 'Application: Senior Software Engineer',
  emailBody: 'Hello, I am interested.',
  emailNotes: 'Posting signals used.',
  linkedInConnectionNote: 'Quick note.',
  linkedInInMail: 'Longer message.',
};

const FIT: Fit = {
  rating: 85,
  analysis: 'Strong match.',
  dimensions: { skillsMatch: 85, experienceMatch: 90, logisticsMatch: 80, cultureMatch: 75 },
  strengths: ['Rails'],
  gaps: [],
  eligibility: { passed: true, reason: '' },
  languageGate: { required: 'en', passed: true, note: '' },
  logisticsNote: null,
};

const EXPECTED_FILES = [
  'application_questions.json',
  'cover_letter.html',
  'cover_letter.pdf',
  'cover_letter_direcionamento.txt',
  'curriculo_direcionado.html',
  'curriculo_direcionado_com_cover.html',
  'email_candidatura.txt',
  'fit_check.json',
  'Horecio-Dias-Software-Engineer-With-Cover.pdf',
  'Horecio-Dias-Software-Engineer.pdf',
  'job_posting.md',
  'materiais_extras/README.md',
  'materiais_extras/sugestoes_respostas.json',
  'materiais_extras/sugestoes_respostas.md',
  'mensagem_linkedin.txt',
  'mensagem_recrutador.txt',
  'mensagem_recrutador_origem.txt',
].sort();

function pdfStub() {
  const calls: { html: string; pdf: string }[] = [];
  return {
    calls,
    renderPdf: async (htmlPath: string, pdfPath: string) => {
      calls.push({ html: htmlPath, pdf: pdfPath });
      fs.writeFileSync(pdfPath, '%PDF-1.4 fake');
      return { atsCompatible: true, charCount: 200, lineCount: 10 };
    },
  };
}

describe('writeKitArtifacts', () => {
  it('writes the exact kit files and registers them with mime and size', async () => {
    const ctx = createTestStore();
    const applicationsDir = fs.mkdtempSync(
      path.join(ctx.dir, 'applications-'),
    );
    dirs.push(applicationsDir);
    const job = ctx.store.jobs.create({
      company: 'Acme Corp.',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
    });
    const { calls, renderPdf } = pdfStub();

    try {
      const result = await writeKitArtifacts(
        {
          store: ctx.store,
          applicationsDir,
          jobId: job.id,
          runId: null,
          kit: KIT,
          job: JOB,
          language: 'en',
          stack: 'ruby',
          fit: FIT,
          fitConfirmed: true,
          coverLetterGuidance: 'Emphasise the Rails upgrade.',
          suggestions: {
            json: { metadata: { language: 'en' }, fieldMappings: {} },
            markdown: '# Suggestions',
            readme: '# Extras',
          },
        },
        { renderPdf },
      );

      expect(result.folder).toBe('acme_corp_senior_software_engineer');
      expect([...result.files].sort()).toEqual(EXPECTED_FILES);
      for (const file of result.files) {
        expect(
          fs.existsSync(path.join(applicationsDir, result.folder, file)),
        ).toBe(true);
      }

      // Resume, cover and combined PDFs, in that order.
      expect(calls).toHaveLength(3);
      expect(calls[0].pdf.endsWith('Horecio-Dias-Software-Engineer.pdf')).toBe(true);
      expect(calls[1].pdf.endsWith('cover_letter.pdf')).toBe(true);
      expect(calls[2].pdf.endsWith('Horecio-Dias-Software-Engineer-With-Cover.pdf')).toBe(
        true,
      );
      expect(result.atsCompatible).toBe(true);

      const artifacts = ctx.store.artifacts.listByJob(job.id);
      const byPath = new Map(artifacts.map((item) => [item.relativePath, item]));
      const cvHtml = byPath.get(`${result.folder}/curriculo_direcionado.html`);
      expect(cvHtml).toMatchObject({
        kind: 'cv_html',
        mime: 'text/html',
        runId: null,
      });
      expect(cvHtml?.sizeBytes).toBe(Buffer.byteLength(RESUME_HTML, 'utf8'));
      expect(byPath.get(`${result.folder}/Horecio-Dias-Software-Engineer.pdf`)?.mime).toBe(
        'application/pdf',
      );
      expect(byPath.get(`${result.folder}/cover_letter.pdf`)?.kind).toBe(
        'cover_letter_pdf',
      );
      expect(
        byPath.get(`${result.folder}/Horecio-Dias-Software-Engineer-With-Cover.pdf`)
          ?.kind,
      ).toBe('cv_with_cover_pdf');
      expect(byPath.get(`${result.folder}/job_posting.md`)?.kind).toBe('job_posting');
      expect(byPath.get(`${result.folder}/application_questions.json`)?.kind).toBe(
        'questions',
      );
      expect(
        byPath.get(`${result.folder}/materiais_extras/sugestoes_respostas.md`)?.kind,
      ).toBe('suggestions');
      expect(byPath.get(`${result.folder}/mensagem_recrutador.txt`)?.kind).toBe(
        'recruiter_note',
      );
      expect(byPath.get(`${result.folder}/mensagem_linkedin.txt`)?.kind).toBe(
        'linkedin_note',
      );
      expect(artifacts).toHaveLength(EXPECTED_FILES.length);
      for (const artifact of artifacts) {
        expect(artifact.sizeBytes).toBeGreaterThan(0);
        expect(artifact.mime).toBeTruthy();
      }

      const updated = ctx.store.jobs.get(job.id);
      expect(updated?.fit?.rating).toBe(85);
      expect(updated?.fitConfirmed).toBe(true);
      expect(updated?.hasQuestions).toBe(true);
      expect(updated?.hasRecruiterMessage).toBe(true);
      expect(updated?.coverInCvRequired).toBe(true);
      expect(updated?.coverInCvReason).toBeTruthy();
      expect(updated?.coverLetterGuidance).toBe('Emphasise the Rails upgrade.');
      expect(result.coverInCv.required).toBe(true);

      const posting = fs.readFileSync(
        path.join(applicationsDir, result.folder, 'job_posting.md'),
        'utf8',
      );
      expect(posting).toContain('# Senior Software Engineer - Acme Corp.');
      expect(posting).toContain('Build products.');
    } finally {
      ctx.cleanup();
    }
  });

  it('adds a numeric suffix instead of overwriting a previous kit', async () => {
    const ctx = createTestStore();
    const applicationsDir = fs.mkdtempSync(path.join(ctx.dir, 'applications-'));
    dirs.push(applicationsDir);
    const job = ctx.store.jobs.create({
      company: 'Acme Corp.',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
    });
    const { renderPdf } = pdfStub();

    try {
      const first = await writeKitArtifacts(
        {
          store: ctx.store,
          applicationsDir,
          jobId: job.id,
          kit: { ...KIT, coverLetterHtml: null },
          job: { ...JOB, extraQuestions: '', recruiterMessage: '' },
          language: 'en',
          stack: 'ruby',
        },
        { renderPdf },
      );
      expect(first.folder).toBe('acme_corp_senior_software_engineer');
      // No cover available: no cover, combined or guidance files.
      expect(first.files).not.toContain('cover_letter.pdf');
      expect(first.files).not.toContain('curriculo_direcionado_com_cover.html');
      expect(first.coverInCv.required).toBe(false);

      const second = await writeKitArtifacts(
        {
          store: ctx.store,
          applicationsDir,
          jobId: job.id,
          kit: { ...KIT, coverLetterHtml: null },
          job: { ...JOB, extraQuestions: '', recruiterMessage: '' },
          language: 'en',
          stack: 'ruby',
        },
        { renderPdf },
      );
      expect(second.folder).toBe('acme_corp_senior_software_engineer_2');
      expect(fs.existsSync(path.join(applicationsDir, first.folder))).toBe(true);
      expect(fs.existsSync(path.join(applicationsDir, second.folder))).toBe(true);

      const updated = ctx.store.jobs.get(job.id);
      expect(updated?.hasQuestions).toBe(false);
      expect(updated?.hasRecruiterMessage).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  it('skips the combined variant when includeCoverInCv is never', async () => {
    const ctx = createTestStore();
    const applicationsDir = fs.mkdtempSync(path.join(ctx.dir, 'applications-'));
    dirs.push(applicationsDir);
    const job = ctx.store.jobs.create({
      company: 'Acme Corp.',
      role: 'Senior Software Engineer',
      language: 'en',
      stack: 'ruby',
    });
    const { renderPdf } = pdfStub();

    try {
      const result = await writeKitArtifacts(
        {
          store: ctx.store,
          applicationsDir,
          jobId: job.id,
          kit: KIT,
          job: JOB,
          language: 'en',
          stack: 'ruby',
          includeCoverInCv: 'never',
        },
        { renderPdf },
      );

      expect(result.coverInCv.required).toBe(false);
      expect(result.files).not.toContain('curriculo_direcionado_com_cover.html');
      expect(result.files).toContain('cover_letter.pdf');
    } finally {
      ctx.cleanup();
    }
  });
});
