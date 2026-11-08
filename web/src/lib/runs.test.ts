import { describe, expect, it } from 'vitest';
import type { Run } from '../api/types';
import { hasActiveRuns, isRunActive, pendingConfirmation } from './runs';

function run(overrides: Partial<Run>): Run {
  return {
    id: 'proc_1',
    jobId: 'app_1',
    stage: 'generating',
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
    llmQuestion: null,
    needsInputRounds: 0,
    clarificationHistory: [],
    coverLetterGuidance: null,
    includeCoverInCv: null,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('runs', () => {
  it('considera ativo tudo que não terminou', () => {
    expect(isRunActive(run({ stage: 'generating' }))).toBe(true);
    expect(isRunActive(run({ stage: 'needs_input' }))).toBe(true);
    expect(isRunActive(run({ stage: 'done' }))).toBe(false);
    expect(isRunActive(run({ stage: 'failed' }))).toBe(false);
  });

  it('mantém ativo quando falta confirmação mesmo com stage terminal', () => {
    expect(isRunActive(run({ stage: 'done', needsFitConfirmation: true }))).toBe(true);
    expect(isRunActive(run({ stage: 'failed', needsLanguageConfirmation: true }))).toBe(true);
  });

  it('detecta runs ativos em uma lista', () => {
    expect(hasActiveRuns(undefined)).toBe(false);
    expect(hasActiveRuns([])).toBe(false);
    expect(hasActiveRuns([run({ stage: 'done' })])).toBe(false);
    expect(hasActiveRuns([run({ stage: 'done' }), run({ stage: 'generating' })])).toBe(true);
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
