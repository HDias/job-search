import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maskApiKey, toPublicLlmConfig } from '../src/domain/llm.js';
import {
  LLM_CONFIG_KEY,
  loadLlmConfig,
  saveLlmConfig,
} from '../src/pipeline/llm/config.js';
import { createSkillLoader } from '../src/pipeline/skills/loader.js';
import {
  resolveTargetProfile,
  targetSystemPrompts,
  withExtraPrompt,
} from '../src/pipeline/prompts.js';
import { createTestStore } from './helpers.js';

const SKILLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
);

describe('llm config (settings llm_config)', () => {
  let ctx: ReturnType<typeof createTestStore>;
  beforeEach(() => {
    ctx = createTestStore();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('returns v1 defaults when nothing was saved', () => {
    const config = loadLlmConfig(ctx.store.settings, {});
    expect(config).toEqual({
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash',
      baseUrl: '',
      temperature: null,
      top_p: null,
      maxTokens: null,
    });
  });

  it('uses GEMINI_API_KEY from the environment when no key was saved', () => {
    const config = loadLlmConfig(ctx.store.settings, {
      GEMINI_API_KEY: 'env-key',
    });
    expect(config.apiKey).toBe('env-key');
  });

  it('does not use the env key for other providers', () => {
    saveLlmConfig(ctx.store.settings, { provider: 'openai' });
    const config = loadLlmConfig(ctx.store.settings, { GEMINI_API_KEY: 'env-key' });
    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('');
    expect(config.model).toBe('gpt-4o');
  });

  it('saves a partial merge: undefined preserves, "" on apiKey keeps the key', () => {
    saveLlmConfig(ctx.store.settings, {
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      temperature: 0.5,
    });

    saveLlmConfig(ctx.store.settings, { apiKey: '', baseUrl: 'https://x.example/v1' });

    const saved = ctx.store.settings.get<Record<string, unknown>>(LLM_CONFIG_KEY)!;
    expect(saved.apiKey).toBe('secret-key');
    expect(saved.baseUrl).toBe('https://x.example/v1');
    expect(saved.model).toBe('gpt-4o-mini');
    expect(saved.temperature).toBe(0.5);
  });

  it('null clears sampling and provider change without model resets the default', () => {
    saveLlmConfig(ctx.store.settings, { temperature: 0.9, maxTokens: 1000 });
    saveLlmConfig(ctx.store.settings, { temperature: null });
    expect(loadLlmConfig(ctx.store.settings, {}).temperature).toBeNull();

    saveLlmConfig(ctx.store.settings, { provider: 'anthropic' });
    expect(loadLlmConfig(ctx.store.settings, {}).model).toBe(
      'claude-3-5-sonnet-20241022',
    );
  });

  it('masks the key using the v1 format', () => {
    const config = loadLlmConfig(ctx.store.settings, {});
    expect(maskApiKey('ABCDEF1234567890WXYZ')).toBe('ABCDEF...WXYZ');
    expect(maskApiKey('')).toBe('');

    const pub = toPublicLlmConfig({
      ...config,
      apiKey: 'ABCDEF1234567890WXYZ',
    });
    expect(pub.hasKey).toBe(true);
    expect(pub.maskedKey).toBe('ABCDEF...WXYZ');
    expect(pub.temperature).toBe('');
    expect(JSON.stringify(pub)).not.toContain('ABCDEF1234567890WXYZ');
  });
});

describe('skill loader (assets under skills/)', () => {
  it('loads the live skill references copied from v1', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    const refs = loader.loadReferences();

    expect(refs.skillMd).toContain('job-application-tailor');
    expect(refs.evaluationFramework.length).toBeGreaterThan(100);
    expect(refs.writingStyleGuide.length).toBeGreaterThan(100);
    expect(refs.emailStyleGuide.length).toBeGreaterThan(100);
    expect(refs.safetyProtocol.length).toBeGreaterThan(100);
  });

  it('buildFitSystemPrompt includes the supreme rule and the framework', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    const prompt = loader.buildFitSystemPrompt();
    expect(prompt).toContain('ZERO LIES');
    expect(prompt).toContain('fit evaluator');
    expect(prompt).toContain(
      loader.loadReferences().evaluationFramework.slice(0, 200),
    );
  });

  it('buildTailorSystemPrompt includes the writing guide and the needsInput protocol', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    const prompt = loader.buildTailorSystemPrompt();
    expect(prompt).toContain('needsInput');
    expect(prompt).toContain('Writing guide (MANDATORY)');
    expect(prompt).toContain('INFERENCE POLICY');
  });

  it('buildEmailSection picks the language note', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    expect(loader.buildEmailSection('en')).toContain('Write the email in English');
    expect(loader.buildEmailSection('pt-br')).toContain('Portuguese (PT-BR)');
  });

  it('templates stay accessible (resume_style.css)', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    expect(fs.existsSync(loader.templatePath('resume_style.css'))).toBe(true);
    expect(loader.readTemplate('resume_style.css')).not.toBe('');
  });

  it('missing references do not break the prompts', () => {
    const emptyDir = fs.mkdtempSync(path.join(SKILLS_DIR, '.tmp-empty-'));
    try {
      const loader = createSkillLoader(emptyDir);
      expect(loader.buildFitSystemPrompt()).toContain('ZERO LIES');
      expect(loader.buildEmailSection('en')).toBe('');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('per-target prompts (enabled + extraPrompt)', () => {
  let ctx: ReturnType<typeof createTestStore>;
  beforeEach(() => {
    ctx = createTestStore();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('resolveTargetProfile ignores disabled and missing profiles', () => {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'en',
      content: { rawText: 'x' },
    });
    ctx.store.profiles.upsert({
      stack: 'php',
      language: 'en',
      enabled: false,
    });

    expect(resolveTargetProfile(ctx.store, 'ruby', 'en')?.enabled).toBe(true);
    expect(resolveTargetProfile(ctx.store, 'php', 'en')).toBeNull();
    expect(resolveTargetProfile(ctx.store, 'naoexiste', 'en')).toBeNull();
  });

  it('withExtraPrompt injects the text with a stack/language header', () => {
    const base = 'BASE-PROMPT';
    expect(withExtraPrompt(base, null)).toBe(base);

    const profile = { stack: 'php', language: 'pt-br', extraPrompt: '  ' };
    expect(withExtraPrompt(base, profile)).toBe(base);

    const withText = {
      stack: 'php',
      language: 'pt-br',
      extraPrompt: ' Prioritize Laravel. ',
    };
    const result = withExtraPrompt(base, withText);
    expect(result).toContain('=== USER EXTRA INSTRUCTIONS (php/pt-br) ===');
    expect(result).toContain('Prioritize Laravel.');
    expect(result.startsWith(base)).toBe(true);
    expect(result).not.toContain('  Prioritize');
  });

  it('targetSystemPrompts applies the extra text to fit and tailor prompts', () => {
    const loader = createSkillLoader(SKILLS_DIR);
    const profile = {
      stack: 'ruby',
      language: 'en',
      extraPrompt: 'Emphasis on Rails and Sidekiq.',
    };

    const { fitSystem, tailorSystem } = targetSystemPrompts(loader, profile);

    expect(fitSystem).toContain('fit evaluator');
    expect(fitSystem).toContain('Emphasis on Rails and Sidekiq.');
    expect(tailorSystem).toContain('needsInput');
    expect(tailorSystem).toContain('Emphasis on Rails and Sidekiq.');
  });
});
