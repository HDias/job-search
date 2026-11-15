import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * PDF rendering with an ATS text-layer check (port of v1 `generate_pdf.mjs`)
 * plus the cover-in-CV helpers from `job_processor.mjs`.
 *
 * Chromium is injected: the queue reuses one browser and tests never launch
 * a real one (F1). ATS verification is a `pdftotext -layout` dump next to the
 * PDF, also injectable so tests do not depend on the poppler binary.
 */

/* ---------------------------- cover in CV ---------------------------- */

const COVER_IN_CV_PATTERNS = [
  /cover\s*(letter|ing).{0,100}(in|inside|within|as\s+part\s+of|included?\s+in|embedded?\s+in|appended?\s+to|at\s+the\s+end\s+of).{0,80}(cv|resum[eé]|r[ée]sum[ée])/i,
  /(cv|resum[eé]|r[ée]sum[ée]).{0,100}(includ|contain|with|including|plus|with\s+a|together\s+with).{0,80}cover/i,
  /(upload|submit|attach|provide|send|include).{0,60}(cv|resum[eé]).{0,80}cover/i,
  /cover.{0,80}(upload|submit|attach).{0,60}(cv|resum[eé])/i,
  /single\s+(file|pdf|document).{0,80}cover/i,
  /cover.{0,80}single\s+(file|pdf|document)/i,
  /same\s+file.{0,60}cover|cover.{0,60}same\s+file/i,
  /combined?\s+(cv|resum[eé]).{0,40}cover|cover.{0,40}combined?\s+(cv|resum[eé])/i,
  /cover\s*letter\s*(section|part|page)\s*(in|of|at\s+the\s+end\s+of).{0,60}(cv|resum[eé])/i,
  /carta.{0,60}apresenta.{0,100}(no|na|em|junto|inclu|anex|dentro|parte\s+do).{0,80}(cv|curr[íi]culo)/i,
  /(cv|curr[íi]culo).{0,100}(inclu|contendo|com|juntamente|anex|acompanhado).{0,80}carta/i,
  /arquivo\s+[úu]nico.{0,80}carta|carta.{0,80}arquivo\s+[úu]nico/i,
  /mesmo\s+(arquivo|pdf|documento).{0,80}carta|carta.{0,80}mesmo\s+(arquivo|pdf|documento)/i,
];

export interface CoverRequirement {
  required: boolean;
  reason: string | null;
}

/**
 * Detects postings that want the cover letter inside the CV file. "separate
 * files" negates the requirement unless the snippet also mentions a section
 * or the same file.
 */
export function detectCoverLetterInCvRequirement(
  text: unknown,
): CoverRequirement {
  const full = String(text ?? '');
  if (!full) return { required: false, reason: null };

  for (const regex of COVER_IN_CV_PATTERNS) {
    const match = full.match(regex);
    if (!match || match.index === undefined) continue;
    const around = full.slice(
      Math.max(0, match.index - 40),
      match.index + match[0].length + 40,
    );
    if (
      /separat/i.test(around) &&
      !/section|same file|single file|includ/i.test(around)
    ) {
      continue;
    }
    const snippet = full
      .slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
    return {
      required: true,
      reason: `Padrão "${regex.source.slice(0, 60)}…" — trecho: "${snippet}"`,
    };
  }
  return { required: false, reason: null };
}

/** Body-only fragment of a cover letter (no doctype, `<html>`, `<head>` or `<style>`). */
export function extractCoverBodyFragment(coverHtml: unknown): string {
  let fragment = String(coverHtml ?? '');
  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bodyMatch) fragment = bodyMatch[1];
  return fragment
    .replace(/<!(DOCTYPE|--)[\s\S]*?(>|-->)/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .trim();
}

/**
 * Puts the cover letter first, right after the single `.accent` band, and
 * forces a page break so the resume starts on a new page. Only order/layout
 * change — the kit text is untouched and the separate cover still exists.
 */
export function buildCombinedCvWithCoverHtml(
  resumeHtml: unknown,
  coverLetterHtml: unknown,
  lang: string,
): string {
  const resume = String(resumeHtml ?? '');
  const fragment = extractCoverBodyFragment(coverLetterHtml);
  if (!resume || !fragment) {
    throw new Error('CV ou cover letter vazios — combinação impossível.');
  }
  const heading = lang === 'en' ? 'Cover Letter' : 'Carta de Apresentação';
  const section =
    `<section class="cover-in-cv" style="page-break-after: always;">` +
    `<h2 class="section-title">${heading}</h2>` +
    `<div class="summary-text">${fragment}</div></section>`;

  const accent = resume.match(
    /<div[^>]*class=["'][^"']*\baccent\b[^"']*["'][^>]*>\s*<\/div\s*>/i,
  );
  if (accent?.index !== undefined) {
    const position = accent.index + accent[0].length;
    return resume.slice(0, position) + section + resume.slice(position);
  }
  const body = resume.match(/<body[^>]*>/i);
  if (body?.index !== undefined) {
    const position = body.index + body[0].length;
    return resume.slice(0, position) + section + resume.slice(position);
  }
  return section + resume;
}

/* -------------------------------- PDF --------------------------------- */

export const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
} as const;

/** Minimum extractable non-whitespace characters for an ATS-friendly PDF. */
export const ATS_MIN_CHARS = 100;

export interface PdfPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  pdf(options: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

export interface PdfContext {
  newPage(): Promise<PdfPage>;
  close?(): Promise<void>;
}

export interface PdfBrowser {
  newContext(options: Record<string, unknown>): Promise<PdfContext>;
  close?(): Promise<void>;
}

export type PdfBrowserFactory = () => Promise<PdfBrowser>;

export interface PdfResult {
  pdfPath: string;
  /** Text dump written next to the PDF (absent when extraction failed). */
  atsLayerPath?: string;
  atsCompatible: boolean;
  charCount: number;
  lineCount: number;
  error?: string;
}

export interface GeneratePdfDeps {
  /** Shared Chromium instance; when omitted, `launchBrowser` runs. */
  browser?: PdfBrowser;
  launchBrowser?: PdfBrowserFactory;
  /** Leave the browser open (shared instance owned by the queue). */
  keepBrowser?: boolean;
  /** `pdftotext -layout` replacement for tests. */
  extractText?: (pdfPath: string) => string;
  warn?: (message: string) => void;
}

/** Lazily loads Playwright so the module can be imported without Chromium. */
async function launchPlaywrightBrowser(): Promise<PdfBrowser> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return {
    newContext: (options) => browser.newContext(options),
    close: () => browser.close(),
  };
}

function defaultExtractText(pdfPath: string): string {
  return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    encoding: 'utf8',
  });
}

/**
 * Renders an HTML resume/kit to an ATS-friendly PDF (A4, 15 mm margins,
 * printed backgrounds) and dumps the extracted text layer next to it.
 */
export async function generatePdf(
  htmlPath: string,
  outputPdfPath: string,
  deps: GeneratePdfDeps = {},
): Promise<PdfResult> {
  const absoluteHtmlPath = path.resolve(htmlPath);
  const absolutePdfPath = path.resolve(outputPdfPath);
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  fs.mkdirSync(path.dirname(absolutePdfPath), { recursive: true });

  const browser =
    deps.browser ??
    (await (deps.launchBrowser ?? launchPlaywrightBrowser)());
  const ownsBrowser = !deps.browser && !deps.keepBrowser;

  try {
    const context = await browser.newContext({});
    const page = await context.newPage();
    await page.goto(pathToFileURL(absoluteHtmlPath).href, {
      waitUntil: 'networkidle',
    });
    await page.pdf({ ...PDF_OPTIONS, path: absolutePdfPath });
    await context.close?.();
  } finally {
    if (ownsBrowser) await browser.close?.();
  }

  let text: string;
  try {
    text = (deps.extractText ?? defaultExtractText)(absolutePdfPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[ATS Warning] pdftotext falhou ou não encontrou texto: ${message}`);
    return {
      pdfPath: absolutePdfPath,
      atsCompatible: false,
      charCount: 0,
      lineCount: 0,
      error: message,
    };
  }

  const atsLayerPath = absolutePdfPath.replace(/\.pdf$/i, '_ats_layer.txt');
  fs.writeFileSync(atsLayerPath, text, 'utf8');

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const charCount = text.replace(/\s+/g, '').length;

  return {
    pdfPath: absolutePdfPath,
    atsLayerPath,
    atsCompatible: charCount > ATS_MIN_CHARS,
    charCount,
    lineCount: lines.length,
  };
}
