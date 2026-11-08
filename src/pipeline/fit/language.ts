/** Language detection for the hybrid engine (port of `fit/utils/language.js`). */

const PT_MARKERS = new Set([
  'é', 'ão', 'ção', 'mente', 'idade', 'para', 'com', 'não', 'está', 'tem', 'são',
  'dos', 'das', 'uma', 'um', 'os', 'as', 'nos', 'nas', 'pelo', 'pela', 'pelos',
  'pelas', 'onde', 'quando', 'como', 'porque', 'pois', 'logo', 'então', 'porém',
  'todavia', 'contudo', 'entretanto', 'antes', 'depois', 'durante', 'enquanto',
  'desde', 'até', 'já', 'ainda', 'também', 'só', 'mesmo', 'muito', 'pouco',
  'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'outros', 'outras', 'tal',
  'tais', 'qual', 'quais', 'quanto', 'quantos', 'de', 'da', 'do', 'em', 'no',
  'na', 'se', 'que', 'por', 'mais', 'mas', 'seu', 'sua', 'ao', 'aos', 'à', 'às',
]);

const EN_MARKERS = new Set([
  'the', 'and', 'for', 'with', 'are', 'have', 'has', 'this', 'that', 'from',
  'they', 'been', 'will', 'would', 'you', 'your', 'our', 'we', 'not', 'but',
  'his', 'her', 'their', 'its', 'was', 'were', 'being', 'could', 'should', 'may',
  'might', 'must', 'can', 'shall', 'do', 'does', 'did', 'doing', 'done', 'into',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'now', 'out', 'up',
  'down', 'off', 'on', 'in', 'at', 'by', 'to',
]);

const PT_ACCENTS = /[áéíóúâêôãõç]/;

export function detectLanguage(
  text: unknown,
  sampleSize = 200,
): 'pt' | 'en' {
  if (!text) return 'en';

  if (PT_ACCENTS.test(String(text))) return 'pt';

  const words = String(text).toLowerCase().split(/\s+/).slice(0, sampleSize);

  let ptCount = 0;
  let enCount = 0;
  for (const word of words) {
    if (PT_MARKERS.has(word)) ptCount++;
    if (EN_MARKERS.has(word)) enCount++;
  }

  if (ptCount > enCount && ptCount >= 3) return 'pt';
  if (enCount > ptCount && enCount >= 3) return 'en';

  const techEn = ['software', 'engineer', 'developer', 'engineering', 'experience', 'years', 'with', 'using'];
  const techPt = ['software', 'engenheiro', 'desenvolvedor', 'engenharia', 'experiência', 'anos', 'com', 'usando'];

  let techEnCount = 0;
  let techPtCount = 0;
  for (const word of words) {
    if (techEn.includes(word)) techEnCount++;
    if (techPt.includes(word)) techPtCount++;
  }

  return techEnCount >= techPtCount ? 'en' : 'pt';
}

export function detectLanguageWithConfidence(
  text: unknown,
  sampleSize = 200,
): { lang: 'pt' | 'en'; confidence: number } {
  if (!text) return { lang: 'en', confidence: 0.5 };

  if (PT_ACCENTS.test(String(text))) return { lang: 'pt', confidence: 0.95 };

  const words = String(text).toLowerCase().split(/\s+/).slice(0, sampleSize);

  let ptCount = 0;
  let enCount = 0;
  for (const word of words) {
    if (PT_MARKERS.has(word)) ptCount++;
    if (EN_MARKERS.has(word)) enCount++;
  }

  const total = ptCount + enCount;
  if (total === 0) return { lang: 'en', confidence: 0.5 };

  if (ptCount > enCount) {
    return {
      lang: 'pt',
      confidence: Math.min(0.5 + ((ptCount - enCount) / total) * 0.5, 0.9),
    };
  }
  return {
    lang: 'en',
    confidence: Math.min(0.5 + ((enCount - ptCount) / total) * 0.5, 0.9),
  };
}
