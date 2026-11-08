/**
 * Deterministic hybrid fit engine (port of `src/fit/index.js`).
 * It never calls the LLM and never goes through the async queue.
 */

import {
  calculateFinalFit,
  explainFit,
  type FinalFitResult,
} from './aggregation/scorer.js';
import { detectLanguage } from './language.js';
import {
  calculateSemanticFit,
  type SemanticFitResult,
} from './semantic/index.js';
import {
  analyzeProfileForFit,
  classifyJobRequirements,
  matchMustHaveWithExperience,
  type RequirementMatch,
} from './temporal/index.js';
import type { JobRequirements } from './temporal/requirements.js';
import type { ProfileEvidence } from './profile.js';

export interface HybridFitInput {
  cvPT?: string | null;
  cvEN?: string | null;
  jobText: string;
  jobLang?: 'auto' | 'pt' | 'en';
  options?: { detailed?: boolean };
}

export interface HybridFitResult {
  fitPercentage: number;
  language: 'pt' | 'en';
  cvLanguageUsed: 'pt' | 'en';
  breakdown: FinalFitResult['breakdown'];
  explanation: string;
  details: {
    semantic: SemanticFitResult['details'];
    temporal: {
      details: RequirementMatch[];
      totalRequirements: number;
      matchedRequirements: number;
      coverage: number;
    };
    evidence: ProfileEvidence[];
    jobRequirements: JobRequirements;
  };
  metadata: {
    algorithm: 'hybrid-v1';
    latencyMs: number;
    timestamp: string;
    cvLength: number;
    jobLength: number;
  };
  detailedReport?: Record<string, unknown>;
}

export function calculateFitHybrid(input: HybridFitInput): HybridFitResult {
  const startTime = Date.now();
  const { cvPT, cvEN, jobText } = input;
  const jobLang = input.jobLang ?? 'auto';
  const options = input.options ?? {};

  const detectedLang = jobLang === 'auto' ? detectLanguage(jobText) : jobLang;
  const cvText = detectedLang === 'pt' ? cvPT : cvEN;
  if (!cvText) {
    throw new Error(
      `CV em ${detectedLang.toUpperCase()} é obrigatório para vaga em ${detectedLang.toUpperCase()}`,
    );
  }

  const semanticResult = calculateSemanticFit(cvText, jobText, detectedLang);
  const temporalProfile = analyzeProfileForFit(cvText);
  const { mustHave, differentials } = classifyJobRequirements(jobText);
  const techRequirements = [...new Set([...mustHave, ...differentials])];
  const temporalResult = matchMustHaveWithExperience(
    techRequirements,
    temporalProfile.stacks,
  );

  const finalResult = calculateFinalFit(
    semanticResult,
    temporalResult,
    temporalProfile.evidence.length,
  );
  const explanation = explainFit(finalResult);
  const temporalMeta = finalResult.components?.temporal ?? {
    totalRequirements: 0,
    matchedRequirements: 0,
    coverage: 0,
  };

  return {
    fitPercentage: finalResult.fitPercentage,
    language: detectedLang,
    cvLanguageUsed: detectedLang,
    breakdown: finalResult.breakdown,
    explanation: explanation.summary,
    details: {
      semantic: semanticResult.details,
      temporal: {
        details: temporalResult.details,
        totalRequirements: temporalMeta.totalRequirements || 0,
        matchedRequirements: temporalMeta.matchedRequirements || 0,
        coverage: temporalMeta.coverage || 0,
      },
      evidence: temporalProfile.evidence,
      jobRequirements: { mustHave, differentials, mustHaveRaw: '', differentialRaw: '' },
    },
    metadata: {
      algorithm: 'hybrid-v1',
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      cvLength: cvText.length,
      jobLength: jobText.length,
    },
    ...(options.detailed
      ? {
          detailedReport: buildDetailedReport(
            semanticResult,
            temporalResult,
            temporalProfile.evidence.length,
            finalResult,
          ),
        }
      : {}),
  };
}

function buildDetailedReport(
  semanticResult: SemanticFitResult,
  temporalResult: ReturnType<typeof matchMustHaveWithExperience>,
  evidenceCount: number,
  finalResult: FinalFitResult,
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    finalScore: finalResult.fitPercentage,
    breakdown: finalResult.breakdown,
    semantic: {
      score: semanticResult.score,
      rawScore: semanticResult.rawScore,
      tfCosine: semanticResult.breakdown.tfCosine,
      skills: {
        score: semanticResult.breakdown.skills,
        cvCount: semanticResult.details.skills.cv.length,
        jobCount: semanticResult.details.skills.job.length,
        matches: semanticResult.details.skills.matches.map((match) => ({
          cv: match.entityA,
          job: match.entityB,
          score: Math.round(match.score * 100),
        })),
        coverage: semanticResult.details.skills.coverage,
      },
      titles: {
        score: semanticResult.breakdown.title,
        cv: semanticResult.details.titles.cv,
        job: semanticResult.details.titles.job,
        matches: semanticResult.details.titles.matches.map((match) => ({
          cv: match.entityA,
          job: match.entityB,
          score: Math.round(match.score * 100),
        })),
      },
      techJaccard: semanticResult.breakdown.techJaccard,
    },
    temporal: {
      score: temporalResult.score || temporalResult.coverage,
      coverage: temporalResult.coverage,
      totalRequirements: temporalResult.totalRequirements,
      matchedRequirements: temporalResult.matchedRequirements,
      details: temporalResult.details.map((detail) => ({
        requirement: detail.requirement,
        matched: detail.score > 0,
        matchedTerm: detail.matchedTerm,
        stackKey: detail.stackKey,
        years: detail.years,
        score: Math.round((detail.score || 0) * 100),
        missing: detail.missing || false,
      })),
    },
    evidence: {
      count: evidenceCount,
      score: finalResult.breakdown.evidence,
    },
    weights: finalResult.weights,
  };
}

export { detectLanguage };
