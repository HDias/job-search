/**
 * Weights and thresholds of the deterministic hybrid engine (port of
 * `src/fit/config/weights.js`). Env overrides are kept for parity with v1.
 */

function envNumber(key: string, fallback: number): number {
  const raw = Number.parseFloat(process.env[key] ?? '');
  return Number.isFinite(raw) ? raw : fallback;
}

export const WEIGHTS = {
  semantic: {
    tfCosine: envNumber('FIT_W_TF_COSINE', 0.4),
    fuzzySkills: envNumber('FIT_W_FUZZY_SKILLS', 0.35),
    techJaccard: envNumber('FIT_W_TECH_JACCARD', 0.15),
    titleMatch: envNumber('FIT_W_TITLE_MATCH', 0.1),
  },
  temporal: {
    mustHaveCoverage: envNumber('FIT_W_MUST_HAVE', 0.7),
    stackYears: envNumber('FIT_W_STACK_YEARS', 0.3),
  },
  final: {
    semantic: envNumber('FIT_W_FINAL_SEMANTIC', 0.4),
    temporal: envNumber('FIT_W_FINAL_TEMPORAL', 0.4),
    evidence: envNumber('FIT_W_FINAL_EVIDENCE', 0.2),
  },
  calibration: {
    semantic: {
      steepness: envNumber('FIT_CAL_SEM_STEEPNESS', 10),
      midpoint: envNumber('FIT_CAL_SEM_MIDPOINT', 0.4),
    },
    final: {
      steepness: envNumber('FIT_CAL_FINAL_STEEPNESS', 8),
      midpoint: envNumber('FIT_CAL_FINAL_MIDPOINT', 0.45),
    },
  },
  thresholds: {
    skillFuzzy: envNumber('FIT_TH_SKILL_FUZZY', 0.85),
    titleFuzzy: envNumber('FIT_TH_TITLE_FUZZY', 0.8),
    companyFuzzy: envNumber('FIT_TH_COMPANY_FUZZY', 0.9),
    minStackYearsForFullScore: envNumber('FIT_TH_MIN_YEARS', 5),
  },
} as const;

export const CONFIG = {
  stopwords: {
    pt: [
      'a', 'o', 'e', 'de', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não',
      'no', 'na', 'os', 'as', 'dos', 'das', 'se', 'que', 'por', 'mais', 'como',
      'mas', 'seu', 'sua', 'seus', 'suas', 'ao', 'aos', 'à', 'às', 'pelo', 'pela',
      'pelos', 'pelas', 'ou', 'pois', 'logo', 'então', 'porém', 'todavia',
      'contudo', 'entretanto', 'antes', 'depois', 'durante', 'enquanto', 'desde',
      'até', 'onde', 'quando', 'porque', 'já', 'ainda', 'também', 'só', 'mesmo',
      'muito', 'pouco', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra',
      'outros', 'outras', 'tal', 'tais', 'qual', 'quais', 'quanto', 'quantos',
    ],
    en: [
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
      'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
      'will', 'with', 'this', 'but', 'they', 'have', 'had', 'what', 'when',
      'where', 'who', 'which', 'why', 'how', 'all', 'each', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
      'than', 'too', 'very', 'can', 'just', 'should', 'now', 'you', 'your', 'our',
      'we', 'i', 'me', 'my', 'us', 'or', 'if', 'then', 'been', 'being', 'do',
      'does', 'did', 'doing', 'done', 'into', 'over', 'under', 'again', 'further',
      'once', 'here', 'there',
    ],
  },
  ngramSizes: [2, 3],
  minTermLength: 3,
  maxEvidenceForFullScore: 12,
} as const;
