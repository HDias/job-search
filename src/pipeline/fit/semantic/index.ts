/** Semantic pipeline: TF cosine + fuzzy skills + tech Jaccard + title match. */

import { WEIGHTS } from '../config.js';
import { extractTitles, extractTechSkills } from './entities.js';
import * as similarity from './similarity.js';
import * as tokenizer from './tokenizer.js';

interface EntityMatch {
  entityA: string;
  entityB: string;
  score: number;
  indexB: number;
}

interface FuzzyResult {
  score: number;
  matches: EntityMatch[];
  coverage: number;
  avgScore: number;
}

function fuzzyMatchEntities(
  listA: string[],
  listB: string[],
  threshold = 0.85,
): FuzzyResult {
  if (!listA?.length || !listB?.length) {
    return { score: 0, matches: [], coverage: 0, avgScore: 0 };
  }

  const matches: EntityMatch[] = [];
  const matchedB = new Set<number>();

  for (const entityA of listA) {
    let bestMatch: EntityMatch | null = null;
    let bestScore = 0;

    for (let i = 0; i < listB.length; i++) {
      if (matchedB.has(i)) continue;
      const entityB = listB[i];
      const score = similarity.jaroWinkler(entityA, entityB);

      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestMatch = { entityA, entityB, score, indexB: i };
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
      matchedB.add(bestMatch.indexB);
    }
  }

  const coverage = listB.length > 0 ? matches.length / listB.length : 0;
  const avgScore =
    matches.length > 0
      ? matches.reduce((sum, match) => sum + match.score, 0) / matches.length
      : 0;

  return { score: coverage * avgScore, matches, coverage, avgScore };
}

function calculateTfCosine(
  textA: string,
  textB: string,
  language = 'en',
): number {
  const tokensA = tokenizer.tokenizePreservingGlossary(textA, language);
  const tokensB = tokenizer.tokenizePreservingGlossary(textB, language);
  const noStopA = tokenizer.removeStopwords(tokensA, language);
  const noStopB = tokenizer.removeStopwords(tokensB, language);
  return similarity.cosineTf(noStopA, noStopB);
}

function calculateTechJaccard(skillsA: string[], skillsB: string[]): number {
  const setA = new Set(skillsA.map((skill) => skill.toLowerCase()));
  const setB = new Set(skillsB.map((skill) => skill.toLowerCase()));
  return similarity.jaccard(setA, setB);
}

export interface SemanticFitResult {
  score: number;
  rawScore: number;
  breakdown: {
    tfCosine: number;
    skills: number;
    techJaccard: number;
    title: number;
  };
  details: {
    skills: {
      cv: string[];
      job: string[];
      matches: EntityMatch[];
      coverage: number;
      avgScore: number;
    };
    titles: {
      cv: string[];
      job: string[];
      matches: EntityMatch[];
      coverage: number;
    };
    tfCosine: number;
    techJaccard: number;
  };
}

export function calculateSemanticFit(
  cvText: string,
  jobText: string,
  language = 'en',
): SemanticFitResult {
  const cvSkills = extractTechSkills(cvText, language);
  const jobSkills = extractTechSkills(jobText, language);
  const cvTitles = extractTitles(cvText, language);
  const jobTitles = extractTitles(jobText, language);

  const skillsResult = fuzzyMatchEntities(
    cvSkills,
    jobSkills,
    WEIGHTS.thresholds.skillFuzzy,
  );
  const titleResult = fuzzyMatchEntities(
    cvTitles,
    jobTitles,
    WEIGHTS.thresholds.titleFuzzy,
  );
  const tfCosine = calculateTfCosine(cvText, jobText, language);
  const techJaccard = calculateTechJaccard(cvSkills, jobSkills);

  const weights = WEIGHTS.semantic;
  const rawScore =
    weights.tfCosine * tfCosine +
    weights.fuzzySkills * skillsResult.score +
    weights.techJaccard * techJaccard +
    weights.titleMatch * titleResult.score;

  const calibrated = similarity.sigmoid(
    rawScore,
    WEIGHTS.calibration.semantic.steepness,
    WEIGHTS.calibration.semantic.midpoint,
  );

  return {
    score: calibrated,
    rawScore,
    breakdown: {
      tfCosine,
      skills: skillsResult.score,
      techJaccard,
      title: titleResult.score,
    },
    details: {
      skills: {
        cv: cvSkills,
        job: jobSkills,
        matches: skillsResult.matches,
        coverage: skillsResult.coverage,
        avgScore: skillsResult.avgScore,
      },
      titles: {
        cv: cvTitles,
        job: jobTitles,
        matches: titleResult.matches,
        coverage: titleResult.coverage,
      },
      tfCosine,
      techJaccard,
    },
  };
}

/** Kept for parity with v1; the semantic pipeline is synchronous. */
export const calculateSemanticFitSync = calculateSemanticFit;
