/** Temporal pipeline: profile analysis + must-have vs experience matching. */

import { analyzeProfile, type AnalyzedProfile } from '../profile.js';
import { normalizeText } from '../semantic/tokenizer.js';
import {
  extractJobRequirements,
  type JobRequirements,
} from './requirements.js';

export interface TemporalStack {
  months: number;
  blocks: number;
  mentions: number;
  years: number;
}

export interface TemporalProfile {
  totalExperienceYears: number;
  totalLabel: string;
  earliest: string | null;
  jobs: number;
  gapMonths: number;
  stacks: Record<string, TemporalStack>;
  evidence: AnalyzedProfile['evidence'];
  rawProfile: AnalyzedProfile;
}

export function analyzeProfileForFit(rawText: unknown): TemporalProfile {
  const profile = analyzeProfile(rawText);

  const stacksWithMonths: Record<string, TemporalStack> = {};
  for (const [name, data] of Object.entries(profile.stacks)) {
    stacksWithMonths[name.toLowerCase()] = {
      months: data.months,
      blocks: data.blocks,
      mentions: data.mentions,
      years: data.months / 12,
    };
  }

  return {
    totalExperienceYears: profile.totalMonths / 12,
    totalLabel: profile.totalLabel,
    earliest: profile.earliest,
    jobs: profile.jobs,
    gapMonths: profile.gapMonths,
    stacks: stacksWithMonths,
    evidence: profile.evidence || [],
    rawProfile: profile,
  };
}

function extractTechTermsFromRequirement(requirement: string): string[] {
  const terms = new Set<string>();
  const normalized = normalizeText(requirement);

  const patterns = [
    /\b(?:with|in|using|knowledge of|experience with|proficient in|expertise in|familiar with|hands.on)\s+([\w\s.+#\-/]+)/gi,
    /\b(?:ruby on rails|rails|python|java|go|golang|rust|javascript|typescript|php|ruby|c#|c\+\+|postgresql|mysql|mongodb|redis|aws|azure|gcp|kubernetes|docker|terraform|react|vue|angular|node\.js|nodejs)\b/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const term = (match[1] || match[0]).trim().toLowerCase();
      if (term.length > 2) terms.add(term);
    }
  }

  const techWords = normalized.match(
    /\b(?:ruby|rails|python|java|go|golang|rust|javascript|typescript|php|postgresql|mysql|mongodb|redis|aws|azure|gcp|kubernetes|docker|terraform|react|vue|angular|node|spring|django|flask|fastapi|express|nestjs|laravel|graphql|grpc|microservices|ci\/cd|github actions|gitlab ci|sidekiq|capistrano|elasticsearch|prometheus|grafana|datadog|newrelic|sentry|splunk)\b/gi,
  );
  if (techWords) {
    for (const word of techWords) terms.add(word.toLowerCase());
  }

  return Array.from(terms);
}

const STACK_ALIASES = new Map<string, string>([
  ['ruby on rails', 'rails'],
  ['rails', 'rails'],
  ['ruby', 'ruby'],
  ['postgresql', 'postgresql'],
  ['postgres', 'postgresql'],
  ['mysql', 'mysql'],
  ['javascript', 'javascript'],
  ['typescript', 'typescript'],
  ['js', 'javascript'],
  ['ts', 'typescript'],
  ['node.js', 'node.js'],
  ['nodejs', 'node.js'],
  ['go', 'go'],
  ['golang', 'go'],
  ['aws', 'aws'],
  ['amazon web services', 'aws'],
  ['gcp', 'gcp'],
  ['google cloud', 'gcp'],
  ['azure', 'azure'],
  ['kubernetes', 'kubernetes'],
  ['k8s', 'kubernetes'],
  ['docker', 'docker'],
  ['terraform', 'terraform'],
  ['ci/cd', 'ci/cd'],
  ['cicd', 'ci/cd'],
  ['github actions', 'github actions'],
  ['gitlab ci', 'gitlab ci'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['angular', 'angular'],
  ['spring boot', 'spring boot'],
  ['django', 'django'],
  ['fastapi', 'fastapi'],
  ['express', 'express'],
  ['nestjs', 'nestjs'],
]);

function normalizeStackTerm(term: string): string {
  const normalized = term.toLowerCase().trim();
  return STACK_ALIASES.get(normalized) || normalized;
}

export interface RequirementMatch {
  requirement: string;
  matchedTerm: string | null;
  stackKey?: string;
  years?: number;
  months?: number;
  blocks?: number;
  score: number;
  fuzzy?: boolean;
  similarity?: number;
  missing?: boolean;
}

export interface TemporalMatchResult {
  coverage: number;
  score: number;
  details: RequirementMatch[];
  totalRequirements: number;
  matchedRequirements: number;
}

function jaroWinklerSimple(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1?.length || !s2?.length) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + 0.1 * prefix * (1 - jaro);
}

export function matchMustHaveWithExperience(
  mustHave: string[],
  cvStacks: Record<string, TemporalStack>,
): TemporalMatchResult {
  if (!mustHave?.length) {
    return { coverage: 1, details: [], score: 1, totalRequirements: 0, matchedRequirements: 0 };
  }

  let totalScore = 0;
  const details: RequirementMatch[] = [];

  for (const requirement of mustHave) {
    const techTerms = extractTechTermsFromRequirement(requirement);
    let requirementScore = 0;
    let bestMatch: RequirementMatch | null = null;

    for (const term of techTerms) {
      const stackKey = normalizeStackTerm(term);
      const stackData = cvStacks[stackKey];

      if (stackData) {
        const yearsScore = Math.min(stackData.years / 5, 1);
        if (yearsScore > requirementScore) {
          requirementScore = yearsScore;
          bestMatch = {
            requirement,
            matchedTerm: term,
            stackKey,
            years: stackData.years,
            months: stackData.months,
            blocks: stackData.blocks,
            score: yearsScore,
          };
        }
      }
    }

    if (!bestMatch) {
      for (const term of techTerms) {
        for (const [stackKey, stackData] of Object.entries(cvStacks)) {
          const similarity = jaroWinklerSimple(term, stackKey);
          if (similarity >= 0.85) {
            const yearsScore = Math.min(stackData.years / 5, 1) * similarity;
            if (yearsScore > requirementScore) {
              requirementScore = yearsScore;
              bestMatch = {
                requirement,
                matchedTerm: term,
                stackKey,
                years: stackData.years,
                months: stackData.months,
                blocks: stackData.blocks,
                score: yearsScore,
                fuzzy: true,
                similarity,
              };
            }
          }
        }
      }
    }

    totalScore += requirementScore;
    details.push(
      bestMatch || {
        requirement,
        matchedTerm: null,
        score: 0,
        missing: true,
      },
    );
  }

  const coverage = mustHave.length > 0 ? totalScore / mustHave.length : 1;

  return {
    coverage,
    score: coverage,
    details,
    totalRequirements: mustHave.length,
    matchedRequirements: details.filter((detail) => detail.score > 0).length,
  };
}

export function classifyJobRequirements(jobText: unknown): JobRequirements {
  return extractJobRequirements(jobText);
}
