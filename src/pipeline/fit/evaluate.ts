import type { Fit } from '../../domain/job.js';
import type { Store } from '../../repositories/types.js';
import { resolveLanguagePair } from '../profiles.js';
import {
  calculateFitHybrid,
  type HybridFitResult,
} from './index.js';

/**
 * Synchronous "Retry fit" entry point (`POST /api/evaluate-fit`, D12).
 * Deterministic and fast: it never calls the LLM, so it does not go through
 * the async queue.
 */

export interface EvaluateFitInput {
  jobText: string;
  jobLang?: 'auto' | 'pt' | 'en';
  applicationId?: string | null;
  stack?: string | null;
}

export interface EvaluateFitResult {
  result: HybridFitResult;
  fit: Fit;
  applicationId: string | null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Maps hybrid breakdown onto the skill framework dimensions (v1 parity). */
export function hybridResultToFit(result: HybridFitResult): Fit {
  const { breakdown } = result;
  const skillsMatch = clamp(
    Math.round((breakdown.semantic * 0.7 + breakdown.temporal * 0.3) * 100),
  );
  const experienceMatch = clamp(
    Math.round((breakdown.temporal * 0.8 + breakdown.evidence * 0.2) * 100),
  );
  const logisticsMatch = 70;
  const cultureMatch = clamp(
    Math.round((breakdown.semantic * 0.6 + breakdown.evidence * 0.4) * 100),
  );
  const rating = result.fitPercentage;

  return {
    rating,
    analysis: result.explanation,
    dimensions: {
      skillsMatch,
      experienceMatch,
      logisticsMatch,
      cultureMatch,
    },
    strengths: [
      `Similaridade semântica: ${Math.round(breakdown.semantic * 100)}%`,
      `Cobertura temporal requisitos: ${Math.round(breakdown.temporal * 100)}%`,
      `Evidências produção: ${Math.round(breakdown.evidence * 100)}%`,
    ],
    gaps:
      breakdown.temporal < 0.5
        ? ['Alguns requisitos técnicos não cobertos por experiência temporal']
        : [],
    eligibility: {
      passed: true,
      reason: 'Sem bloqueio de elegibilidade detectado',
    },
    languageGate: {
      required: result.language === 'pt' ? 'pt-br' : 'en',
      passed: true,
      note: `Idioma detectado: ${result.language}`,
    },
  };
}

export function evaluateFit(
  store: Store,
  input: EvaluateFitInput,
): EvaluateFitResult {
  const job = input.applicationId
    ? store.jobs.get(input.applicationId)
    : null;
  const stack = input.stack || job?.stack || 'ruby';
  const { cvPT, cvEN } = resolveLanguagePair(store, stack);

  if (!cvPT && !cvEN) {
    throw new Error(
      'Nenhum currículo base habilitado encontrado. Habilite um alvo na aba Admin (App Settings) e tente novamente.',
    );
  }

  const result = calculateFitHybrid({
    cvPT,
    cvEN,
    jobText: input.jobText,
    jobLang: input.jobLang ?? 'auto',
    options: { detailed: true },
  });
  const fit = hybridResultToFit(result);

  if (job) {
    store.jobs.update(job.id, { fit });
  }

  return { result, fit, applicationId: job?.id ?? null };
}
