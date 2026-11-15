import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * Text extraction for uploaded base resumes. The pipeline only needs the raw
 * text, so uploads stay in memory (D1: no pipeline state on `fs`) and PDFs are
 * piped through `pdftotext` (`poppler-utils`) instead of being stored.
 */

export interface ResumeFile {
  buffer: Buffer;
  originalname: string;
}

export type ResumeTextExtractor = (file: ResumeFile) => Promise<string>;

export interface ResumeTextOptions {
  /** Test seam: runs the PDF extraction without spawning `pdftotext`. */
  runPdftotext?: (buffer: Buffer) => Promise<string>;
}

/** `pdftotext` output ceiling, comfortably above a 10 MB PDF. */
export const PDFTOTEXT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Reads the PDF from stdin (`-`) and writes the layout-preserving text to
 * stdout (`-`), so no temporary file is created.
 */
export function runPdftotext(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', '-', '-'],
      { encoding: 'utf8', maxBuffer: PDFTOTEXT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout ?? ''));
      },
    );

    child.stdin?.on('error', reject);
    child.stdin?.end(buffer);
  });
}

export function createResumeTextExtractor(
  options: ResumeTextOptions = {},
): ResumeTextExtractor {
  const pdftotext = options.runPdftotext ?? runPdftotext;

  return async ({ buffer, originalname }) => {
    const extension = path.extname(originalname).toLowerCase();
    if (extension === '.pdf') return pdftotext(buffer);
    return buffer.toString('utf8');
  };
}
