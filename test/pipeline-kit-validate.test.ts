import { afterEach, describe, expect, it } from 'vitest';
import { extractCoverageTerms } from '../src/pipeline/fit/profile.js';
import {
  DEFAULT_PDF_THEME,
  accentFor,
  getPdfTheme,
  resolvePdfTheme,
} from '../src/pipeline/pdf-theme.js';
import {
  BANNED_PHRASES,
  extractAmmoNumbers,
  stripTags,
  validateResumeContent,
  validateResumeHtml,
} from '../src/pipeline/kit/validate.js';
import { createTestStore } from './helpers.js';

const GOOD_HTML = `<!DOCTYPE html><html><body><div class="accent"></div><div class="page"><h1 class="name">X</h1><div class="headline">Y</div><div class="contact">Z</div><h2 class="section-title">S</h2><p class="summary">W</p><p class="skills"><strong>Backend:</strong> Rails</p><div class="job"><div class="company">C</div><div class="dates">D</div><ul><li>B</li></ul></div><style>.accent{background:#B56A6A}</style></div></body></html>`;

function html(body: string): string {
  return `<!DOCTYPE html><html><body><div class="accent"></div><div class="skills">${body}</div></body></html>`;
}

let ctx: ReturnType<typeof createTestStore> | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('pdf theme', () => {
  it('exposes the v1 defaults', () => {
    expect(DEFAULT_PDF_THEME.ruby.accent).toBe('#B56A6A');
    expect(DEFAULT_PDF_THEME.php.accent).toBe('#4F5B93');
    expect(DEFAULT_PDF_THEME.cssVersion).toBe('b1');
  });

  it('merges the settings theme over the defaults', () => {
    const theme = resolvePdfTheme({
      ruby: { accent: '#112233' },
      cssVersion: 'b2',
    });
    expect(theme.ruby.accent).toBe('#112233');
    expect(theme.ruby.accentDark).toBe('#9E4A4A');
    expect(theme.cssVersion).toBe('b2');
  });

  it('reads settings.pdf_theme (single source, no duplicated reader)', () => {
    ctx = createTestStore();
    expect(getPdfTheme(ctx.store).ruby.accent).toBe('#B56A6A');

    ctx.store.settings.set('pdf_theme', { php: { accent: '#AABBCC' } });
    expect(getPdfTheme(ctx.store).php.accent).toBe('#AABBCC');
    expect(accentFor(getPdfTheme(ctx.store), 'php')).toBe('#AABBCC');
  });
});

describe('validateResumeHtml', () => {
  it('accepts the reference layout B document', () => {
    const result = validateResumeHtml(GOOD_HTML, {
      stack: 'ruby',
      accentColor: '#B56A6A',
    });
    expect(result.ok).toBe(true);
    expect(result.hardViolations).toEqual([]);
  });

  it('flags pills in the Highlights block', () => {
    const bad = GOOD_HTML.replace(
      '<strong>Backend:</strong> Rails',
      '<span class="skill">Rails</span>',
    );
    const result = validateResumeHtml(bad, {
      stack: 'ruby',
      accentColor: '#B56A6A',
    });
    expect(result.hardViolations.map((v) => v.code)).toContain(
      'highlights-pills',
    );
  });

  it('requires exactly one accent band with the stack color', () => {
    const missing = GOOD_HTML.replace('class="accent"', 'class="band"');
    expect(
      validateResumeHtml(missing, { stack: 'ruby', accentColor: '#B56A6A' })
        .hardViolations.map((v) => v.code),
    ).toContain('accent-missing');

    const duplicated = GOOD_HTML.replace(
      '<div class="page">',
      '<div class="page"><div class="accent"></div>',
    );
    expect(
      validateResumeHtml(duplicated, { stack: 'ruby', accentColor: '#B56A6A' })
        .hardViolations.map((v) => v.code),
    ).toContain('accent-multiple');

    const wrong = GOOD_HTML.replace(/#B56A6A/g, '#000000');
    expect(
      validateResumeHtml(wrong, { stack: 'ruby', accentColor: '#B56A6A' })
        .hardViolations.map((v) => v.code),
    ).toContain('accent-color-mismatch');
  });

  it('rejects external assets and multi-column layouts', () => {
    const external = GOOD_HTML.replace(
      '<style>',
      '<link rel="stylesheet" href="x.css"><style>',
    );
    expect(
      validateResumeHtml(external, { stack: 'ruby', accentColor: '#B56A6A' })
        .hardViolations.map((v) => v.code),
    ).toContain('external-asset');

    const columns = GOOD_HTML.replace(
      '<style>',
      '<style>.page{column-count:2}',
    );
    expect(
      validateResumeHtml(columns, { stack: 'ruby', accentColor: '#B56A6A' })
        .hardViolations.map((v) => v.code),
    ).toContain('multi-column');
  });

  it('uses the settings theme when no accent is passed', () => {
    const result = validateResumeHtml(GOOD_HTML, { stack: 'ruby' });
    expect(result.expectedAccent).toBe('#B56A6A');
    expect(result.ok).toBe(true);
  });
});

describe('validateResumeContent', () => {
  it('flags missing coverage and banned clichés', () => {
    const result = validateResumeContent(
      html('RSpec, Docker. Proven track record of success.'),
      { mustCover: [{ term: 'FactoryBot', src: '\\bfactory\\s?bot\\b' }] },
    );
    const codes = result.hardViolations.map((v) => v.code);
    expect(codes).toContain('missing-coverage');
    expect(codes).toContain('banned-phrase');
    expect(result.ok).toBe(false);
  });

  it('flags hallucinated forbidden terms', () => {
    const result = validateResumeContent(html('Terraform expert.'), {
      forbidden: [{ term: 'Terraform', src: '\\bterraform\\b' }],
    });
    expect(result.hardViolations.map((v) => v.code)).toContain(
      'hallucinated-term',
    );
  });

  it('accepts a correct kit and ignores optional warnings as hard failures', () => {
    const result = validateResumeContent(
      html('RSpec and FactoryBot with TDD. Mentored juniors.'),
      {
        mustCover: [
          { term: 'FactoryBot', src: '\\bfactory\\s?bot\\b' },
          { term: 'mentoring', src: '\\bmentor\\w*\\b' },
        ],
        bannedPhrases: BANNED_PHRASES,
      },
    );
    expect(result.ok).toBe(true);
  });

  it('requires at least one ammo number, flagging underuse as optional', () => {
    const ignored = validateResumeContent(html('No numbers here.'), {
      ammoNumbers: ['78', '2000'],
    });
    expect(ignored.hardViolations.map((v) => v.code)).toContain('ammo-ignored');

    const partial = validateResumeContent(html('78 municípios.'), {
      ammoNumbers: ['78', '2000', '9+', '300'],
    });
    const codes = partial.violations.map((v) => v.code);
    expect(codes).toContain('ammo-underused');
    expect(partial.ok).toBe(true);
  });

  it('flags dropped core terms as an optional warning', () => {
    const result = validateResumeContent(html('Rails only.'), {
      coreKept: [{ term: 'Datadog', baseHits: 6 }],
    });
    const dropped = result.violations.find((v) => v.code === 'core-dropped');
    expect(dropped?.optional).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('extracts ammo numbers while excluding years', () => {
    const numbers = extractAmmoNumbers(
      'desde 2019, 78 municípios, 9+ anos, 2000 requisições',
    );
    expect(numbers.some((n) => /2019/.test(n))).toBe(false);
    expect(numbers).toContain('78');
    expect(numbers.length).toBeGreaterThan(0);
  });

  it('strips tags before matching', () => {
    expect(stripTags('<p>A <strong>B</strong></p>')).toBe(' A B ');
  });
});

describe('coverage core threshold', () => {
  const base = (hits: number) =>
    `${Array.from({ length: hits }, () => 'Datadog').join(' ')}`;

  it('keeps a term with exactly 5 base mentions as core (>= boundary)', () => {
    const terms = extractCoverageTerms('Ruby role.', base(5)).coreKept.map(
      (term) => term.term,
    );
    expect(terms).toContain('Datadog');
  });

  it('does not keep a term with 4 base mentions', () => {
    const terms = extractCoverageTerms('Ruby role.', base(4)).coreKept.map(
      (term) => term.term,
    );
    expect(terms).not.toContain('Datadog');
  });
});
