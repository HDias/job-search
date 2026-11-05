import { describe, expect, it } from 'vitest';
import type { Run } from '../api/types';
import { hasActiveRuns, isRunActive, pendingConfirmation } from './runs';

function run(overrides: Partial<Run>): Run {
  return {
    id: 'proc_1',
    jobId: 'app_1',
    stage: 'processing',
    url: null,
    stack: null,
    languagePreference: null,
    detectedLanguage: null,
    suggestedLanguage: null,
    needsLanguageConfirmation: false,
    needsFitConfirmation: false,
    eligibilityBlocked: false,
    hasRawText: false,
    hasExtraQuestions: false,
    hasRecruiterMessage: false,
    error: null,
    fit: null,
    job: null,
    jobSnapshot: null,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('runs', () => {
  it('considera ativo tudo que não terminou', () => {
    expect(isRunActive(run({ stage: 'processing' }))).toBe(true);
    expect(isRunActive(run({ stage: 'awaiting-language' }))).toBe(true);
    expect(isRunActive(run({ stage: 'done' }))).toBe(false);
    expect(isRunActive(run({ stage: 'error' }))).toBe(false);
  });

  it('mantém ativo quando falta confirmação mesmo com stage terminal', () => {
    expect(isRunActive(run({ stage: 'done', needsFitConfirmation: true }))).toBe(true);
    expect(isRunActive(run({ stage: 'error', needsLanguageConfirmation: true }))).toBe(true);
  });

  it('detecta runs ativos em uma lista', () => {
    expect(hasActiveRuns(undefined)).toBe(false);
    expect(hasActiveRuns([])).toBe(false);
    expect(hasActiveRuns([run({ stage: 'done' })])).toBe(false);
    expect(hasActiveRuns([run({ stage: 'done' }), run({ stage: 'processing' })])).toBe(true);
  });

  it('prioriza confirmação de idioma sobre fit', () => {
    expect(pendingConfirmation(undefined)).toBeNull();
    expect(pendingConfirmation([run({ needsFitConfirmation: true })])).toBe('fit');
    expect(
      pendingConfirmation([
        run({ needsFitConfirmation: true }),
        run({ needsLanguageConfirmation: true }),
      ]),
    ).toBe('language');
  });
});
