/** Standalone similarity algorithms (port of v1 `semantic/similarity.js`). */

export function jaroWinkler(s1: string, s2: string): number {
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

  // Winkler prefix bonus (up to 4 chars).
  let prefix = 0;
  const maxPrefix = Math.min(4, len1, len2);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + 0.1 * prefix * (1 - jaro);
}

export function levenshtein(s1: string, s2: string): number {
  if (s1 === s2) return 0;
  if (!s1?.length) return s2?.length || 0;
  if (!s2?.length) return s1?.length || 0;

  const len1 = s1.length;
  const len2 = s2.length;

  let prevRow = new Array<number>(len2 + 1);
  let currRow = new Array<number>(len2 + 1);

  for (let j = 0; j <= len2; j++) prevRow[j] = j;

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost,
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[len2];
}

export function levenshteinNormalized(s1: string, s2: string): number {
  const distance = levenshtein(s1, s2);
  const maxLen = Math.max(s1?.length || 0, s2?.length || 0);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

export function diceCoefficient(s1: string, s2: string): number {
  if (!s1?.length || !s2?.length) return 0;
  if (s1 === s2) return 1.0;

  const getBigrams = (value: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < value.length - 1; i++) {
      bigrams.add(value.slice(i, i + 2));
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  return (2 * intersection) / (bigrams1.size + bigrams2.size) || 0;
}

export function diceWordBigrams(
  tokens1: string[],
  tokens2: string[],
): number {
  if (!tokens1?.length || !tokens2?.length) return 0;

  const getBigrams = (tokens: string[]): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(tokens1);
  const bigrams2 = getBigrams(tokens2);

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  return bigrams1.size + bigrams2.size > 0
    ? (2 * intersection) / (bigrams1.size + bigrams2.size)
    : 0;
}

export function jaccard(
  set1: Set<string>,
  set2: Set<string>,
): number {
  if (!set1?.size && !set2?.size) return 1;
  if (!set1?.size || !set2?.size) return 0;

  let intersection = 0;
  for (const item of set1) {
    if (set2.has(item)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function cosineSimilarity(
  vecA: Record<string, number>,
  vecB: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(vecA || {}), ...Object.keys(vecB || {})]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key of keys) {
    const a = vecA[key] || 0;
    const b = vecB[key] || 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function cosineTf(tokensA: string[], tokensB: string[]): number {
  const tfA: Record<string, number> = {};
  const tfB: Record<string, number> = {};

  for (const token of tokensA) tfA[token] = (tfA[token] || 0) + 1;
  for (const token of tokensB) tfB[token] = (tfB[token] || 0) + 1;

  const normA = Math.sqrt(
    Object.values(tfA).reduce((sum, value) => sum + value * value, 0),
  );
  const normB = Math.sqrt(
    Object.values(tfB).reduce((sum, value) => sum + value * value, 0),
  );

  for (const key of Object.keys(tfA)) tfA[key] /= normA || 1;
  for (const key of Object.keys(tfB)) tfB[key] /= normB || 1;

  return cosineSimilarity(tfA, tfB);
}

export function tfidfSimilarity(
  tokensA: string[],
  tokensB: string[],
  corpusSize = 1000,
): number {
  const tfA: Record<string, number> = {};
  const tfB: Record<string, number> = {};

  for (const token of tokensA) tfA[token] = (tfA[token] || 0) + 1;
  for (const token of tokensB) tfB[token] = (tfB[token] || 0) + 1;

  const normA = Math.sqrt(
    Object.values(tfA).reduce((sum, value) => sum + value * value, 0),
  );
  const normB = Math.sqrt(
    Object.values(tfB).reduce((sum, value) => sum + value * value, 0),
  );
  for (const key of Object.keys(tfA)) tfA[key] /= normA || 1;
  for (const key of Object.keys(tfB)) tfB[key] /= normB || 1;

  const allTerms = new Set([...tokensA, ...tokensB]);
  const idf: Record<string, number> = {};

  for (const term of allTerms) {
    const df =
      (tokensA.includes(term) ? 1 : 0) + (tokensB.includes(term) ? 1 : 0);
    idf[term] = Math.log((corpusSize + 1) / (df + 0.5));
  }

  const vecA: Record<string, number> = {};
  const vecB: Record<string, number> = {};
  for (const term of allTerms) {
    vecA[term] = (tfA[term] || 0) * idf[term];
    vecB[term] = (tfB[term] || 0) * idf[term];
  }

  return cosineSimilarity(vecA, vecB);
}

export function sigmoid(
  x: number,
  steepness = 10,
  midpoint = 0.5,
): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}
