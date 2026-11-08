import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkJobFit } from '../src/pipeline/kit/fit.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import type { ScrapedJob } from '../src/pipeline/scrape/job.js';
import { createSkillLoader } from '../src/pipeline/skills/loader.js';
import { createTestStore } from './helpers.js';

const SKILLS_DIR = path.resolve('skills');

const REAL_JD = `Senior Ruby on Rails Engineer at ShipHawk.
Requirements: 5+ years with Ruby on Rails, PostgreSQL, Sidekiq, RSpec and Docker.
Experience building REST APIs in production. Responsibilities: design, code reviews,
mentoring juniors. Benefits: remote friendly, salary range, English communication. `.repeat(8);

const FIT_PAYLOAD = {
  company: 'ShipHawk',
  role: 'Senior Ruby on Rails Engineer',
  eligibility: { passed: true, reason: 'Sem exigência de visto' },
  languageGate: { required: 'en', passed: true, note: 'Inglês profissional' },
  skillsMatch: 85,
  experienceMatch: 90,
  logisticsMatch: 80,
  cultureMatch: 75,
  fitRating: 84,
  fitAnalysis: 'Boa aderência técnica.',
  strengths: ['Rails em produção'],
  gaps: ['Kubernetes'],
  recommendation: 'proceed',
};

const SCRAPED: ScrapedJob = {
  url: 'https://example.com/job',
  scrapedAt: '2026-11-08T00:00:00.000Z',
  title: 'Ruby Engineer',
  company: 'Example',
  location: 'Remote',
  applyUrl: 'https://example.com/apply',
  detectedLanguage: 'en',
  languageConfidence: { ptScore: 0, enScore: 8 },
  content: REAL_JD,
  via: 'playwright',
};

let ctx: ReturnType<typeof createTestStore>;
let llmCalls: { prompt: string; system: string }[];

function stubLlm(response = JSON.stringify(FIT_PAYLOAD)): LlmClient {
  return {
    async call(prompt, system = '') {
      llmCalls.push({ prompt, system });
      return response;
    },
  };
}

function seedProfile(extraPrompt: string | null = null): void {
  ctx.store.profiles.upsert({
    stack: 'ruby',
    language: 'en',
    enabled: true,
    extraPrompt,
    content: { rawText: REAL_JD, rawLength: REAL_JD.length },
  });
}

function deps(overrides: {
  llm?: LlmClient;
  scrape?: (url: string) => Promise<ScrapedJob>;
} = {}) {
  return {
    store: ctx.store,
    loader: createSkillLoader(SKILLS_DIR),
    llm: overrides.llm ?? stubLlm(),
    scrape: overrides.scrape,
  };
}

beforeEach(() => {
  ctx = createTestStore();
  llmCalls = [];
  seedProfile();
});

afterEach(() => {
  ctx.cleanup();
});

describe('checkJobFit', () => {
  it('runs the LLM fit for pasted text without scraping', async () => {
    const scrape = vi.fn(async () => SCRAPED);
    const result = await checkJobFit(deps({ scrape }), {
      rawText: REAL_JD,
      languagePreference: 'en',
      stack: 'ruby',
    });

    expect(scrape).not.toHaveBeenCalled();
    expect(result.needsManualContent).toBeUndefined();
    expect(result.fit?.rating).toBe(84);
    expect(result.fit?.dimensions?.skillsMatch).toBe(85);
    expect(result.fit?.logisticsNote).toBeNull();
    expect(result.detectedLanguage).toBe('en');
    expect(result.needsLanguageConfirmation).toBe(false);
    expect(result.needsFitConfirmation).toBe(false);
    expect(result.jobSnapshot.content?.length).toBeGreaterThan(0);
    expect(llmCalls).toHaveLength(1);
  });

  it('reuses the cached snapshot instead of scraping again', async () => {
    const scrape = vi.fn(async () => SCRAPED);
    const result = await checkJobFit(deps({ scrape }), {
      url: 'https://example.com/job',
      jobSnapshot: {
        title: 'Cached role',
        company: 'Cached Co',
        url: 'https://example.com/job',
        detectedLanguage: 'en',
        content: REAL_JD,
      },
    });

    expect(scrape).not.toHaveBeenCalled();
    expect(result.fit?.rating).toBe(84);
    expect(result.job.company).toBe('ShipHawk');
  });

  it('flags thin scrapes and asks for the pasted text without calling the LLM', async () => {
    const scrape = vi.fn(async () => ({
      ...SCRAPED,
      content: 'Please enable JavaScript to continue',
    }));
    const result = await checkJobFit(deps({ scrape }), {
      url: 'https://example.com/job',
      stack: 'ruby',
    });

    expect(scrape).toHaveBeenCalledOnce();
    expect(result.needsManualContent).toBe(true);
    expect(result.fit).toBeNull();
    expect(result.jobSnapshot.contentThin).toBe(true);
    expect(result.manualContentReason).toMatch(/cole/i);
    expect(llmCalls).toHaveLength(0);
  });

  it('prefers pasted text over a thin scrape', async () => {
    const scrape = vi.fn(async () => ({
      ...SCRAPED,
      content: 'Please enable JavaScript to continue',
    }));
    const result = await checkJobFit(deps({ scrape }), {
      url: 'https://example.com/job',
      rawText: REAL_JD,
      languagePreference: 'en',
      stack: 'ruby',
    });

    expect(result.needsManualContent).toBeUndefined();
    expect(result.fit?.rating).toBe(84);
    expect(llmCalls).toHaveLength(1);
  });

  it('injects the enabled target extra prompt into the fit system prompt', async () => {
    seedProfile('Priorizar vagas de plataforma e observabilidade.');
    await checkJobFit(deps(), {
      rawText: REAL_JD,
      languagePreference: 'en',
      stack: 'ruby',
    });

    expect(llmCalls[0].system).toContain(
      'Priorizar vagas de plataforma e observabilidade.',
    );
  });

  it('rejects when no enabled base resume exists', async () => {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'en',
      enabled: false,
      content: { rawText: REAL_JD },
    });

    await expect(
      checkJobFit(deps(), {
        rawText: REAL_JD,
        languagePreference: 'en',
        stack: 'ruby',
      }),
    ).rejects.toThrow(/habilitado/i);
  });

  it('fails with a clear error when the LLM does not return JSON', async () => {
    await expect(
      checkJobFit(deps({ llm: stubLlm('not json at all') }), {
        rawText: REAL_JD,
        languagePreference: 'en',
        stack: 'ruby',
      }),
    ).rejects.toThrow(/JSON válido/);
  });
});
