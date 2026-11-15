import { describe, expect, it } from 'vitest';
import {
  buildCombinedCvWithCoverHtml,
  detectCoverLetterInCvRequirement,
} from '../src/pipeline/pdf.js';

/**
 * Port of v1 `scripts/cover-in-cv.test.mjs`: high-precision detection of
 * "cover letter inside the CV" postings and the combined document layout.
 */

describe('cover-in-CV: explicit request detection (high precision)', () => {
  const YES = [
    'Please upload your CV including a cover letter in the same file.',
    'Your resume must include a cover letter section at the end.',
    'Upload your CV and cover letter in the same file.',
    'Add a separate cover letter section in your CV.',
    'Anexe seu currículo com carta de apresentação no mesmo arquivo.',
    'Inclua a carta de apresentação no CV.',
  ];
  const NO = [
    'Please submit your resume and a separate cover letter.',
    'Upload your CV and cover letter as separate files.',
    'Envie currículo e carta de apresentação.',
    'Cover letter required.',
  ];

  for (const text of YES) {
    it(`detects: "${text.slice(0, 50)}…"`, () => {
      expect(detectCoverLetterInCvRequirement(text).required).toBe(true);
    });
  }

  for (const text of NO) {
    it(`does not fire: "${text.slice(0, 50)}…"`, () => {
      expect(detectCoverLetterInCvRequirement(text).required).toBe(false);
    });
  }

  it('does not fire on empty text', () => {
    expect(detectCoverLetterInCvRequirement('').required).toBe(false);
  });
});

describe('cover-in-CV: combined document with the cover first', () => {
  const resume =
    '<!DOCTYPE html><html><head></head><body><div class="accent"></div><h1 class="candidate-name">CV</h1><h2 class="section-title">Summary</h2></body></html>';
  const cover =
    '<!DOCTYPE html><html><head></head><body><p>Dear Team,</p><p>Body.</p></body></html>';

  it('puts the cover before the CV content (right after the accent band)', () => {
    const out = buildCombinedCvWithCoverHtml(resume, cover, 'en');
    const coverPosition = out.indexOf('cover-in-cv');
    const cvPosition = out.indexOf('candidate-name');
    expect(coverPosition).toBeGreaterThan(-1);
    expect(cvPosition).toBeGreaterThan(-1);
    expect(coverPosition).toBeLessThan(cvPosition);
  });

  it('keeps exactly one .accent band', () => {
    const out = buildCombinedCvWithCoverHtml(resume, cover, 'en');
    const accents = out.match(/class=["'][^"']*\baccent\b[^"']*["']/gi) ?? [];
    expect(accents).toHaveLength(1);
  });

  it('localizes the heading', () => {
    expect(buildCombinedCvWithCoverHtml(resume, cover, 'en')).toContain('>Cover Letter<');
    expect(buildCombinedCvWithCoverHtml(resume, cover, 'pt-br')).toContain(
      '>Carta de Apresentação<',
    );
  });

  it('does not duplicate <html> or <head> from the cover fragment', () => {
    const out = buildCombinedCvWithCoverHtml(resume, cover, 'en');
    expect((out.match(/<html/gi) ?? []).length).toBe(1);
    expect(out).toContain('Dear Team,');
  });
});
