import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isJobContentThin } from '../src/pipeline/content.js';
import { checkJobFit } from '../src/pipeline/kit/fit.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import { createSkillLoader } from '../src/pipeline/skills/loader.js';
import { createTestStore } from './helpers.js';

/**
 * Port of v1 `scripts/thin-content.test.mjs`: a blocked/shell scrape must ask
 * for the pasted text instead of silently returning a 0% fit.
 */

const SKILLS_DIR = path.resolve('skills');

// Real case: https://jobs.dou.ua/companies/shiphawk/vacancies/375184/
const BLOCKED_LIKE = `Jobs DOU ShipHawk Vacancies Search Login Sign up
Cookies policy Privacy Please enable JavaScript to continue`;

const REAL_JD = `Senior Ruby on Rails Engineer at ShipHawk.
Requirements: 5+ years with Ruby on Rails, PostgreSQL, Sidekiq, RSpec and Docker.
Experience building REST APIs in production. Responsibilities: design, code reviews,
mentoring juniors. Benefits: remote friendly, salary range, English communication. `.repeat(8);

describe('thin scrape → ask for the pasted text (no silent 0% fit)', () => {
  it('treats empty content as thin', () => {
    expect(isJobContentThin('')).toBe(true);
    expect(isJobContentThin('   ')).toBe(true);
  });

  it('treats a blocked shell (dou.ua without the description) as thin', () => {
    expect(isJobContentThin(BLOCKED_LIKE)).toBe(true);
  });

  it('does not treat a real description as thin', () => {
    expect(isJobContentThin(REAL_JD)).toBe(false);
  });

  it('returns needsManualContent for a thin snapshot without calling the LLM', async () => {
    const ctx = createTestStore();
    let calls = 0;
    const llm: LlmClient = {
      async call() {
        calls += 1;
        return '{}';
      },
    };

    try {
      const result = await checkJobFit(
        { store: ctx.store, loader: createSkillLoader(SKILLS_DIR), llm },
        {
          url: 'https://jobs.dou.ua/companies/shiphawk/vacancies/375184/',
          jobSnapshot: {
            url: 'https://jobs.dou.ua/companies/shiphawk/vacancies/375184/',
            title: 'Vaga',
            company: 'Empresa',
            location: '',
            applyUrl: 'https://jobs.dou.ua/companies/shiphawk/vacancies/375184/',
            detectedLanguage: 'en',
            content: BLOCKED_LIKE,
            extraQuestions: '',
          },
        },
      );

      expect(result.needsManualContent).toBe(true);
      expect(result.fit ?? null).toBeNull();
      expect(String(result.manualContentReason ?? '')).toMatch(/Cole|cole/);
      expect(calls).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});
