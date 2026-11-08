import { describe, expect, it } from 'vitest';
import {
  detectLangFromText,
  detectLogisticsNote,
  hasExplicitLanguageRequirement,
  isJobContentThin,
  truncate,
} from '../src/pipeline/content.js';

const REAL_JD = `Senior Ruby on Rails Engineer at ShipHawk.
Requirements: 5+ years with Ruby on Rails, PostgreSQL, Sidekiq, RSpec and Docker.
Experience building REST APIs in production. Responsibilities: design, code reviews,
mentoring juniors. Benefits: remote friendly, salary range, English communication. `.repeat(8);

const BLOCKED_LIKE = `Jobs DOU ShipHawk Vacancies Search Login Sign up
Cookies policy Privacy Please enable JavaScript to continue`;

describe('content helpers', () => {
  it('flags empty and shell content as thin', () => {
    expect(isJobContentThin('')).toBe(true);
    expect(isJobContentThin('   ')).toBe(true);
    expect(isJobContentThin(BLOCKED_LIKE)).toBe(true);
    expect(isJobContentThin(REAL_JD)).toBe(false);
  });

  it('detects the posting language from pasted text', () => {
    expect(detectLangFromText('Requisitos: experiência com Ruby, benefícios e salário.')).toBe(
      'pt-br',
    );
    expect(
      detectLangFromText(
        'Requirements: experience with Ruby. Responsibilities and benefits. You will build APIs.',
      ),
    ).toBe('en');
    expect(detectLangFromText('Vaga para pessoa desenvolvedora sênior, requisitos claros.')).toBe(
      'pt-br',
    );
  });

  it('only blocks language when the posting is explicit', () => {
    expect(
      hasExplicitLanguageRequirement('Please submit your resume translated to English.', 'en'),
    ).toBe(true);
    expect(hasExplicitLanguageRequirement('Senior Ruby engineer, remote.', 'en')).toBe(
      false,
    );
    expect(
      hasExplicitLanguageRequirement('Envie seu currículo em português (PT-BR).', 'pt-br'),
    ).toBe(true);
    expect(
      hasExplicitLanguageRequirement('We are an English-speaking company.', 'pt-br'),
    ).toBe(false);
  });

  it('detects logistics outside Brazil but never for remote worldwide', () => {
    expect(
      detectLogisticsNote({
        location: 'Glasgow, Scotland',
        content:
          'Hybrid Remote position in the United Kingdom. Visa sponsorship not available.',
      }),
    ).toContain('fora do Brasil');
    expect(
      detectLogisticsNote({
        location: 'Remote worldwide',
        content: 'Remote worldwide, work from anywhere.',
      }),
    ).toBeNull();
    expect(
      detectLogisticsNote({
        location: '',
        content: 'Senior Ruby engineer, remote friendly.',
      }),
    ).toBeNull();
  });

  it('truncates deterministically', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate(null, 3)).toBe('');
  });
});
