/** Tokenization and preprocessing (port of v1 `semantic/tokenizer.js`). */

import { CONFIG } from '../config.js';
import { TECH_ALIASES, TECH_GLOSSARY } from './glossary.js';

export function normalizeText(text: unknown, removeAccents = false): string {
  if (!text) return '';
  let normalized = String(text).normalize('NFC').toLowerCase().trim();
  if (removeAccents) {
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return normalized;
}

export function tokenizePreservingGlossary(
  text: unknown,
  _language = 'en',
): string[] {
  const normalized = normalizeText(text);
  const tokens = normalized
    .split(/[\s.,;:()[\]{}/\-+=*&^%$#@!]+/)
    .filter((token) => token.length >= CONFIG.minTermLength);

  // Re-join n-grams that belong to the glossary (trigram -> bigram -> unigram).
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i + 2 < tokens.length) {
      const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      if (TECH_GLOSSARY.has(trigram)) {
        result.push(trigram);
        i += 2;
        continue;
      }
    }
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (TECH_GLOSSARY.has(bigram)) {
        result.push(bigram);
        i += 1;
        continue;
      }
    }
    const token = tokens[i];
    const normalizedToken = TECH_ALIASES.get(token) || token;
    if (
      TECH_GLOSSARY.has(normalizedToken) ||
      normalizedToken.length >= CONFIG.minTermLength
    ) {
      result.push(normalizedToken);
    }
  }
  return result;
}

export function removeStopwords(
  tokens: string[],
  language = 'en',
): string[] {
  const stopwords =
    CONFIG.stopwords[language as keyof typeof CONFIG.stopwords] ??
    CONFIG.stopwords.en;
  const stopSet = new Set<string>(stopwords);
  return tokens.filter(
    (token) => !stopSet.has(token) && token.length >= CONFIG.minTermLength,
  );
}

export function preprocess(text: unknown, language = 'en'): string {
  const tokens = tokenizePreservingGlossary(text, language);
  return removeStopwords(tokens, language).join(' ');
}

export function extractGlossaryTerms(text: unknown): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();

  for (const term of TECH_GLOSSARY) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(normalized)) found.add(term);
  }

  return Array.from(found);
}

export function extractNgrams(
  tokens: string[],
  sizes: readonly number[] = CONFIG.ngramSizes,
): Map<number, Set<string>> {
  const ngrams = new Map<number, Set<string>>();
  for (const n of sizes) {
    const set = new Set<string>();
    for (let i = 0; i <= tokens.length - n; i++) {
      set.add(tokens.slice(i, i + n).join(' '));
    }
    ngrams.set(n, set);
  }
  return ngrams;
}

export interface ExperiencePattern {
  skill: string;
  years?: number;
  raw: string;
}

export function extractExperiencePatterns(
  text: unknown,
  language = 'en',
): ExperiencePattern[] {
  if (!text) return [];
  const normalized = normalizeText(text);
  const patterns =
    language === 'pt'
      ? [
          { regex: /(\d+)\s*anos?\s+de\s+([\w\s.+#\-/]+)/gi, yearGroup: 1, skillGroup: 2 },
          { regex: /experi[êe]ncia\s+(?:com|em)\s+([\w\s.+#\-/]+)/gi, yearGroup: null, skillGroup: 1 },
          { regex: /(\d+)\s*anos?\s+(?:de\s+)?(?:experi[êe]ncia\s+(?:com|em)\s+)?([\w\s.+#\-/]+)/gi, yearGroup: 1, skillGroup: 2 },
        ]
      : [
          { regex: /(\d+)\s*years?\s+(?:of\s+)?(?:experience\s+(?:with|in)\s+)?([\w\s.+#\-/]+)/gi, yearGroup: 1, skillGroup: 2 },
          { regex: /experience\s+(?:with|in)\s+([\w\s.+#\-/]+)/gi, yearGroup: null, skillGroup: 1 },
          { regex: /(\d+)\s*years?\s+([\w\s.+#\-/]+)/gi, yearGroup: 1, skillGroup: 2 },
        ];

  const results: ExperiencePattern[] = [];
  for (const { regex, yearGroup, skillGroup } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const years = yearGroup !== null ? Number.parseInt(match[yearGroup], 10) : 0;
      const skill = match[skillGroup]?.trim().toLowerCase() || '';
      if (
        skill.length > 2 &&
        skill.length < 80 &&
        (years === 0 || (years > 0 && years < 50))
      ) {
        results.push({ skill, years: years || undefined, raw: match[0] });
      }
    }
  }
  return results;
}
