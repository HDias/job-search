import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCombinedCvWithCoverHtml,
  detectCoverLetterInCvRequirement,
  extractCoverBodyFragment,
  generatePdf,
  type PdfBrowser,
} from '../src/pipeline/pdf.js';

const RESUME_HTML = `<!DOCTYPE html><html><head><style>.accent{background:#B56A6A}</style></head><body><div class="accent"></div><div class="resume-container"><h1 class="candidate-name">Horecio</h1></div></body></html>`;

const COVER_HTML = `<!DOCTYPE html><html><head><style>body{font:12pt serif}</style></head><body><p>Dear Hiring Manager,</p><p>Sincerely, Horecio</p></body></html>`;

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-pdf-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('detectCoverLetterInCvRequirement', () => {
  it('flags a posting that asks for the cover letter inside the CV', () => {
    const result = detectCoverLetterInCvRequirement(
      'Please submit your CV and cover letter in a single file.',
    );
    expect(result.required).toBe(true);
    expect(result.reason).toContain('single file');
  });

  it('flags the Portuguese phrasing', () => {
    const result = detectCoverLetterInCvRequirement(
      'Anexe seu currículo com carta de apresentação no mesmo arquivo.',
    );
    expect(result.required).toBe(true);
  });

  it('does not flag separate files', () => {
    const result = detectCoverLetterInCvRequirement(
      'Upload your CV and cover letter as separate files.',
    );
    expect(result).toEqual({ required: false, reason: null });
  });

  it('returns false for an empty posting', () => {
    expect(detectCoverLetterInCvRequirement('')).toEqual({
      required: false,
      reason: null,
    });
  });
});

describe('buildCombinedCvWithCoverHtml', () => {
  it('inserts the cover right after the single accent band', () => {
    const combined = buildCombinedCvWithCoverHtml(
      RESUME_HTML,
      COVER_HTML,
      'en',
    );

    const accentCount = (combined.match(/class="accent"/g) ?? []).length;
    expect(accentCount).toBe(1);

    const accentEnd = combined.indexOf('class="accent"') + 'class="accent"></div>'.length;
    const coverStart = combined.indexOf('class="cover-in-cv"');
    const resumeStart = combined.indexOf('class="resume-container"');
    expect(coverStart).toBeGreaterThan(0);
    expect(coverStart).toBeGreaterThan(accentEnd - 1);
    expect(coverStart).toBeLessThan(resumeStart);
    expect(combined).toContain('page-break-after: always');
    expect(combined).toContain('Cover Letter');
  });

  it('localizes the heading and keeps the cover body only', () => {
    const combined = buildCombinedCvWithCoverHtml(
      RESUME_HTML,
      COVER_HTML,
      'pt-br',
    );
    expect(combined).toContain('Carta de Apresentação');
    const section = combined.slice(
      combined.indexOf('class="cover-in-cv"'),
      combined.indexOf('class="resume-container"'),
    );
    expect(section).toContain('Dear Hiring Manager,');
    expect(section).not.toContain('<style>');
    expect(section).not.toContain('<html');
  });

  it('throws when the resume or the cover is empty', () => {
    expect(() => buildCombinedCvWithCoverHtml('', COVER_HTML, 'en')).toThrow();
    expect(() => buildCombinedCvWithCoverHtml(RESUME_HTML, '', 'en')).toThrow();
  });
});

describe('extractCoverBodyFragment', () => {
  it('returns the body content and drops doctype, head and styles', () => {
    const fragment = extractCoverBodyFragment(COVER_HTML);
    expect(fragment).toContain('Dear Hiring Manager,');
    expect(fragment).not.toContain('<style>');
    expect(fragment).not.toContain('DOCTYPE');
  });
});

/** Stub browser: writes a fake PDF at the requested path, never launches Chromium. */
function pdfBrowserStub(onPdf: (buffer: Buffer) => void = () => {}): {
  browser: PdfBrowser;
  calls: { goto: string[]; pdf: Record<string, unknown>[]; closed: number };
} {
  const calls = { goto: [] as string[], pdf: [] as Record<string, unknown>[], closed: 0 };
  const browser: PdfBrowser = {
    async newContext() {
      return {
        async newPage() {
          return {
            async goto(url: string) {
              calls.goto.push(url);
            },
            async pdf(options: Record<string, unknown>) {
              calls.pdf.push(options);
              const buffer = Buffer.from('%PDF-1.4 fake');
              if (typeof options.path === 'string') {
                fs.mkdirSync(path.dirname(options.path), { recursive: true });
                fs.writeFileSync(options.path, buffer);
              }
              onPdf(buffer);
              return buffer;
            },
          };
        },
      };
    },
    async close() {
      calls.closed += 1;
    },
  };
  return { browser, calls };
}

describe('generatePdf', () => {
  it('renders A4 with 15mm margins and printBackground through the injected browser', async () => {
    const dir = tmpDir();
    const { browser, calls } = pdfBrowserStub();
    const htmlPath = path.join(dir, 'cv.html');
    fs.writeFileSync(htmlPath, RESUME_HTML);

    const result = await generatePdf(htmlPath, path.join(dir, 'cv.pdf'), {
      browser,
      extractText: () => 'Horecio Dias '.repeat(20),
      keepBrowser: true,
    });

    expect(calls.goto[0]).toMatch(/^file:\/\//);
    expect(calls.pdf[0]).toMatchObject({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    });
    expect(calls.closed).toBe(0);
    expect(result.pdfPath).toBe(path.join(dir, 'cv.pdf'));
    expect(fs.existsSync(result.pdfPath)).toBe(true);
    expect(fs.existsSync(result.atsLayerPath!)).toBe(true);
    expect(result.atsCompatible).toBe(true);
    expect(result.charCount).toBeGreaterThan(100);
    expect(result.lineCount).toBeGreaterThan(0);
  });

  it('closes a browser it launched itself', async () => {
    const dir = tmpDir();
    const { browser, calls } = pdfBrowserStub();
    const htmlPath = path.join(dir, 'cv.html');
    fs.writeFileSync(htmlPath, RESUME_HTML);

    await generatePdf(htmlPath, path.join(dir, 'cv.pdf'), {
      launchBrowser: async () => browser,
      extractText: () => 'text '.repeat(40),
    });

    expect(calls.closed).toBe(1);
  });

  it('marks a PDF without an extractable text layer as not ATS compatible', async () => {
    const dir = tmpDir();
    const { browser } = pdfBrowserStub();
    const htmlPath = path.join(dir, 'cv.html');
    fs.writeFileSync(htmlPath, RESUME_HTML);

    const result = await generatePdf(htmlPath, path.join(dir, 'cv.pdf'), {
      browser,
      keepBrowser: true,
      extractText: () => 'abc',
    });

    expect(result.atsCompatible).toBe(false);
    expect(result.charCount).toBe(3);
  });

  it('keeps the PDF but reports the failure when text extraction throws', async () => {
    const dir = tmpDir();
    const { browser } = pdfBrowserStub();
    const htmlPath = path.join(dir, 'cv.html');
    fs.writeFileSync(htmlPath, RESUME_HTML);

    const result = await generatePdf(htmlPath, path.join(dir, 'cv.pdf'), {
      browser,
      keepBrowser: true,
      extractText: () => {
        throw new Error('pdftotext missing');
      },
      warn: () => {},
    });

    expect(fs.existsSync(result.pdfPath)).toBe(true);
    expect(result.atsCompatible).toBe(false);
    expect(result.atsLayerPath).toBeUndefined();
    expect(result.error).toContain('pdftotext missing');
  });

  it('creates the output directory when missing', async () => {
    const dir = tmpDir();
    const { browser } = pdfBrowserStub();
    const htmlPath = path.join(dir, 'cv.html');
    fs.writeFileSync(htmlPath, RESUME_HTML);

    const result = await generatePdf(
      htmlPath,
      path.join(dir, 'nested', 'deep', 'cv.pdf'),
      { browser, keepBrowser: true, extractText: () => 'text '.repeat(30) },
    );

    expect(fs.existsSync(result.pdfPath)).toBe(true);
  });
});
