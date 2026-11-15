import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createResumeTextExtractor } from '../src/pipeline/resume-text.js';
import { createTestStore } from './helpers.js';

/**
 * Base resume upload: multipart field `resumeFile`, 10 MB ceiling, PDF text
 * extraction through an injected `pdftotext` runner (never the real binary in
 * the suite) and the document-shaped `profiles.content` record.
 */

const PDF_BYTES = Buffer.from('%PDF-1.7 fake bytes');
const EXTRACTED = 'EXTRACTED BY PDFTOTEXT\nRails 7 · PostgreSQL';
const TEN_MB = 10 * 1024 * 1024;

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let pdfCalls: Buffer[];

beforeEach(() => {
  ctx = createTestStore();
  pdfCalls = [];
  app = createApp({
    store: ctx.store,
    resumeTextExtractor: async ({ buffer, originalname }) => {
      if (!originalname.toLowerCase().endsWith('.pdf')) {
        return buffer.toString('utf8');
      }
      pdfCalls.push(buffer);
      return EXTRACTED;
    },
  });
});

afterEach(() => {
  ctx.cleanup();
});

describe('POST /api/profiles/:stack/:language/upload', () => {
  it('stores the uploaded text resume with the exact content shape', async () => {
    const resume = 'HORECIO DIAS\nRuby · Rails · Ação\n';

    const response = await request(app)
      .post('/api/profiles/ruby/pt-br/upload')
      .attach('resumeFile', Buffer.from(resume, 'utf8'), 'curriculo.txt');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.fileName).toBe('curriculo.txt');
    expect(response.body.charCount).toBe(resume.length);
    expect(pdfCalls).toHaveLength(0);

    const profile = ctx.store.profiles.get('ruby', 'pt-br');
    expect(profile).not.toBeNull();
    expect(profile?.content).toEqual({
      sourceFile: 'curriculo.txt',
      language: 'pt-br',
      stack: 'ruby',
      extractedAt: expect.any(String),
      rawLength: resume.length,
      rawText: resume,
    });
    expect(
      Number.isNaN(Date.parse(String((profile?.content as { extractedAt: string }).extractedAt))),
    ).toBe(false);
  });

  it('extracts PDF text through the injected pdftotext runner', async () => {
    const response = await request(app)
      .post('/api/profiles/php/en/upload')
      .attach('resumeFile', PDF_BYTES, 'resume.pdf');

    expect(response.status).toBe(200);
    expect(pdfCalls).toHaveLength(1);
    expect(pdfCalls[0]?.equals(PDF_BYTES)).toBe(true);
    expect(response.body.charCount).toBe(EXTRACTED.length);

    const profile = ctx.store.profiles.get('php', 'en');
    expect(profile?.content).toMatchObject({
      sourceFile: 'resume.pdf',
      language: 'en',
      stack: 'php',
      rawLength: EXTRACTED.length,
      rawText: EXTRACTED,
    });
  });

  it('keeps the existing enabled flag and extra prompt when replacing content', async () => {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'en',
      content: { rawText: 'old' },
      enabled: false,
      extraPrompt: 'Be concise',
    });

    const response = await request(app)
      .post('/api/profiles/ruby/en/upload')
      .attach('resumeFile', Buffer.from('new resume'), 'cv.md');

    expect(response.status).toBe(200);
    const profile = ctx.store.profiles.get('ruby', 'en');
    expect(profile?.enabled).toBe(false);
    expect(profile?.extraPrompt).toBe('Be concise');
  });

  it('rejects uploads above 10 MB with 413', async () => {
    const oversized = Buffer.alloc(TEN_MB + 1, 0x61);

    const response = await request(app)
      .post('/api/profiles/ruby/pt-br/upload')
      .attach('resumeFile', oversized, 'big.txt');

    expect(response.status).toBe(413);
    expect(ctx.store.profiles.get('ruby', 'pt-br')).toBeNull();
  });

  it('rejects a request without a file', async () => {
    const response = await request(app)
      .post('/api/profiles/ruby/pt-br/upload')
      .field('resumeFile', 'not-a-file');

    expect(response.status).toBe(400);
    expect(ctx.store.profiles.get('ruby', 'pt-br')).toBeNull();
  });

  it('validates stack and language', async () => {
    const badLanguage = await request(app)
      .post('/api/profiles/ruby/fr/upload')
      .attach('resumeFile', Buffer.from('x'), 'cv.txt');
    expect(badLanguage.status).toBe(400);

    const badStack = await request(app)
      .post('/api/profiles/Bad%20Stack/en/upload')
      .attach('resumeFile', Buffer.from('x'), 'cv.txt');
    expect(badStack.status).toBe(400);
  });

  it('answers 422 when the extractor fails or returns no text', async () => {
    const failingApp = createApp({
      store: ctx.store,
      resumeTextExtractor: async () => {
        throw new Error('pdftotext: command not found');
      },
    });

    const failed = await request(failingApp)
      .post('/api/profiles/ruby/pt-br/upload')
      .attach('resumeFile', PDF_BYTES, 'cv.pdf');
    expect(failed.status).toBe(422);
    expect(failed.body.error).toMatch(/extrair/i);

    const emptyApp = createApp({
      store: ctx.store,
      resumeTextExtractor: async () => '   \n ',
    });

    const empty = await request(emptyApp)
      .post('/api/profiles/ruby/pt-br/upload')
      .attach('resumeFile', PDF_BYTES, 'cv.pdf');
    expect(empty.status).toBe(422);
    expect(ctx.store.profiles.get('ruby', 'pt-br')).toBeNull();
  });
});

describe('createResumeTextExtractor', () => {
  it('routes PDFs through pdftotext and other files through UTF-8', async () => {
    const pdfSeen: Buffer[] = [];
    const extract = createResumeTextExtractor({
      runPdftotext: async (buffer) => {
        pdfSeen.push(buffer);
        return 'pdf text';
      },
    });

    await expect(
      extract({ buffer: PDF_BYTES, originalname: 'CV.PDF' }),
    ).resolves.toBe('pdf text');
    expect(pdfSeen).toHaveLength(1);

    await expect(
      extract({ buffer: Buffer.from('Ação'), originalname: 'cv.md' }),
    ).resolves.toBe('Ação');
    await expect(
      extract({ buffer: Buffer.from('plain'), originalname: 'cv' }),
    ).resolves.toBe('plain');
    expect(pdfSeen).toHaveLength(1);
  });
});
