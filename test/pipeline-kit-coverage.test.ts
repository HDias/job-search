import { describe, expect, it } from 'vitest';
import { detectLogisticsNote } from '../src/pipeline/content.js';
import { extractCoverageTerms } from '../src/pipeline/fit/profile.js';
import {
  BANNED_PHRASES,
  extractAmmoNumbers,
  validateResumeContent,
  validateResumeHtml,
} from '../src/pipeline/kit/validate.js';

/**
 * Port of v1 `scripts/coverage.test.mjs`: genuine matches must be covered,
 * forbidden terms must never appear, layout pills are a hard violation.
 */

const BASE =
  'Senior Ruby on Rails engineer. RSpec and FactoryBot with TDD. Docker environments. Datadog monitoring. Mentored juniors. React Native mobile collaboration in 2015.';
const JOB =
  'Senior Ruby on Rails. RSpec and FactoryBot required. Docker and Terraform. Mentoring juniors. React frontend.';

describe('extractCoverageTerms', () => {
  it('sends genuine matches to mustCover', () => {
    const terms = extractCoverageTerms(JOB, BASE).mustCover.map((term) => term.term);
    expect(terms).toContain('FactoryBot');
    expect(terms).toContain('Docker');
    expect(terms).toContain('RSpec');
  });

  it('sends a posting term missing from the base to forbidden', () => {
    const forbidden = extractCoverageTerms(JOB, BASE).forbidden.map((term) => term.term);
    expect(forbidden).toContain('Terraform');
  });

  it('excludes React from coverage (the base has React Native mobile only)', () => {
    const coverage = extractCoverageTerms(JOB, BASE);
    const all = [...coverage.mustCover, ...coverage.forbidden].map((term) => term.term);
    expect(all).not.toContain('React');
  });

  it('keeps a baseSnippet as the base use case', () => {
    const factoryBot = extractCoverageTerms(JOB, BASE).mustCover.find(
      (term) => term.term === 'FactoryBot',
    );
    expect(factoryBot?.baseSnippet?.length ?? 0).toBeGreaterThan(10);
  });
});

describe('detectLogisticsNote', () => {
  it('flags a hybrid role outside Brazil', () => {
    const note = detectLogisticsNote({
      location: 'Glasgow, Scotland',
      content:
        'Hybrid Remote position in the United Kingdom. Visa sponsorship not available.',
    });
    expect(note).toContain('fora do Brasil');
  });

  it('does not flag a worldwide remote role', () => {
    expect(
      detectLogisticsNote({
        location: 'Remote worldwide',
        content: 'Remote worldwide, work from anywhere.',
      }),
    ).toBeNull();
  });

  it('does not flag a posting without an onsite signal', () => {
    expect(
      detectLogisticsNote({
        location: '',
        content: 'Senior Ruby engineer, remote friendly.',
      }),
    ).toBeNull();
  });
});

describe('validateResumeContent (ported)', () => {
  const html = (body: string): string =>
    `<!DOCTYPE html><html><body><div class="accent"></div><div class="skills">${body}</div></body></html>`;

  it('flags missing coverage and a cliché', () => {
    const result = validateResumeContent(
      html('RSpec, Docker. Proven track record of success.'),
      { mustCover: [{ term: 'FactoryBot', src: '\\bfactory\\s?bot\\b' }] },
    );
    expect(result.hardViolations.map((v) => v.code)).toContain('missing-coverage');
    expect(result.hardViolations.map((v) => v.code)).toContain('banned-phrase');
    expect(result.ok).toBe(false);
  });

  it('flags a hallucinated term', () => {
    const result = validateResumeContent(html('Terraform expert.'), {
      forbidden: [{ term: 'Terraform', src: '\\bterraform\\b' }],
    });
    expect(result.hardViolations.map((v) => v.code)).toContain('hallucinated-term');
  });

  it('accepts a correct kit', () => {
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

  it('excludes years from ammo numbers', () => {
    const numbers = extractAmmoNumbers('desde 2019, 78 municípios, 9+ anos, 2000 requisições');
    expect(numbers.some((number) => /2019/.test(number))).toBe(false);
    expect(numbers.length).toBeGreaterThan(0);
  });
});

describe('validateResumeHtml (layout B, ported)', () => {
  const good = `<!DOCTYPE html><html><body><div class="accent"></div><div class="page"><h1 class="name">X</h1><div class="headline">Y</div><div class="contact">Z</div><h2 class="section-title">S</h2><p class="summary">W</p><p class="skills"><strong>Backend:</strong> Rails</p><div class="job"><div class="company">C</div><div class="dates">D</div><ul><li>B</li></ul></div><style>.accent{background:#B56A6A}</style></div></body></html>`;

  it('accepts the reference layout B document', () => {
    const result = validateResumeHtml(good, {
      stack: 'ruby',
      accentColor: '#B56A6A',
    });
    expect(result.ok).toBe(true);
  });

  it('flags pills as highlights-pills', () => {
    const bad = good.replace(
      '<strong>Backend:</strong> Rails',
      '<span class="skill">Rails</span>',
    );
    const result = validateResumeHtml(bad, {
      stack: 'ruby',
      accentColor: '#B56A6A',
    });
    expect(result.hardViolations.map((v) => v.code)).toContain('highlights-pills');
  });
});
