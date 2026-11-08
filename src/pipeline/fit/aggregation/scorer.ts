/** Final aggregation and calibration (port of v1 `aggregation/scorer.js`). */

import { CONFIG, WEIGHTS } from '../config.js';
import * as similarity from '../semantic/similarity.js';
import type { SemanticFitResult } from '../semantic/index.js';
import type { TemporalMatchResult } from '../temporal/index.js';

export interface FinalFitResult {
  fitPercentage: number;
  rawScore: number;
  calibratedScore: number;
  breakdown: {
    semantic: number;
    temporal: number;
    evidence: number;
  };
  components: {
    semantic: SemanticFitResult['details'];
    temporal: {
      details: TemporalMatchResult['details'];
      totalRequirements: number;
      matchedRequirements: number;
      coverage: number;
    };
    evidenceCount: number;
  };
  weights: typeof WEIGHTS.final;
}

export function calculateFinalFit(
  semanticResult: SemanticFitResult,
  temporalResult: TemporalMatchResult,
  evidenceCount: number,
): FinalFitResult {
  const weights = WEIGHTS.final;

  const semanticScore = semanticResult.score || 0;
  const temporalScore = temporalResult.coverage || temporalResult.score || 0;
  const evidenceScore = Math.min(
    evidenceCount / CONFIG.maxEvidenceForFullScore || 12,
    1,
  );

  const rawFinal =
    weights.semantic * semanticScore +
    weights.temporal * temporalScore +
    weights.evidence * evidenceScore;

  const finalScore = similarity.sigmoid(
    rawFinal,
    WEIGHTS.calibration.final.steepness,
    WEIGHTS.calibration.final.midpoint,
  );

  return {
    fitPercentage: Math.round(finalScore * 100),
    rawScore: rawFinal,
    calibratedScore: finalScore,
    breakdown: {
      semantic: semanticScore,
      temporal: temporalScore,
      evidence: evidenceScore,
    },
    components: {
      semantic: semanticResult.details,
      temporal: {
        details: temporalResult.details,
        totalRequirements: temporalResult.totalRequirements,
        matchedRequirements: temporalResult.matchedRequirements,
        coverage: temporalResult.coverage,
      },
      evidenceCount,
    },
    weights,
  };
}

export function explainFit(result: FinalFitResult): {
  fitPercentage: number;
  summary: string;
  details: string[];
} {
  const { breakdown, components, fitPercentage } = result;
  const explanations: string[] = [];

  if (breakdown.semantic > 0.7) {
    explanations.push(
      'Alta similaridade semântica (vocabulário técnico e skills alinhados)',
    );
  } else if (breakdown.semantic > 0.4) {
    explanations.push('Similaridade semântica moderada');
  } else {
    explanations.push('Baixa similaridade semântica (vocabulários distintos)');
  }

  const skillsDetails = components.semantic?.skills;
  if (skillsDetails) {
    const matched = skillsDetails.matches?.length || 0;
    const total = skillsDetails.job?.length || 0;
    if (matched === total && total > 0) {
      explanations.push(`Todas as ${total} skills técnicas da vaga encontradas no CV`);
    } else if (matched > 0) {
      explanations.push(`${matched} de ${total} skills técnicas da vaga encontradas`);
    } else {
      explanations.push('Nenhuma skill técnica da vaga encontrada no CV');
    }
  }

  if (breakdown.temporal > 0.7) {
    explanations.push('Experiência temporal forte nos requisitos obrigatórios');
  } else if (breakdown.temporal > 0.4) {
    explanations.push('Experiência temporal parcial nos requisitos');
  } else {
    explanations.push(
      'Pouca ou nenhuma experiência temporal nos requisitos obrigatórios',
    );
  }

  const matched = components.temporal?.matchedRequirements || 0;
  const total = components.temporal?.totalRequirements || 0;
  if (matched === total && total > 0) {
    explanations.push(
      `Todos os ${total} requisitos obrigatórios cobertos por experiência comprovada`,
    );
  } else if (matched > 0) {
    explanations.push(
      `${matched} de ${total} requisitos obrigatórios cobertos por experiência`,
    );
  }

  const evidenceCount = components.evidenceCount || 0;
  if (evidenceCount >= 8) {
    explanations.push(`${evidenceCount} evidências de produção/escala no CV`);
  } else if (evidenceCount >= 4) {
    explanations.push(`${evidenceCount} evidências de produção no CV`);
  } else {
    explanations.push(`Poucas evidências de produção (${evidenceCount})`);
  }

  return {
    fitPercentage,
    summary: explanations.join(' | '),
    details: explanations,
  };
}
