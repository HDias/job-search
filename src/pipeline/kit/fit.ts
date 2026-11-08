import type { Fit } from '../../domain/job.js';
import type { JobSnapshot } from '../../domain/run.js';
import type { Store } from '../../repositories/types.js';
import {
  detectLangFromText,
  detectLogisticsNote,
  EXTRA_TEXT_LIMIT,
  isJobContentThin,
  JOB_CONTENT_LIMIT,
  normalizeLang,
  normalizeStack,
  PROMPT_EXTRA_LIMIT,
  PROMPT_JOB_LIMIT,
  PROMPT_RESUME_LIMIT,
  THIN_CONTENT_REASON,
  truncate,
} from '../content.js';
import type { LlmClient } from '../llm/client.js';
import {
  resolveProfileWithFallback,
  type ResolvedProfile,
} from '../profiles.js';
import {
  classifyRequirements,
  getProfileSection,
  type ClassifiedRequirements,
} from '../fit/profile.js';
import { targetSystemPrompts } from '../prompts.js';
import type { ScrapeDeps, ScrapedJob } from '../scrape/job.js';
import { scrapeJob } from '../scrape/job.js';
import type { SkillLoader } from '../skills/loader.js';

/**
 * Phase-1 fit check (skill Steps 2-3). Port of v1 `checkJobFit`: scrapes (or
 * reuses) the posting, walks the thin-content fallback, runs the LLM fit call
 * with the live skill framework and returns the persisted run payload.
 * It never writes artifacts and never creates a job.
 */

export interface FitCheckInput {
  url?: string | null;
  rawText?: string | null;
  extraQuestions?: string | null;
  recruiterMessage?: string | null;
  languagePreference?: string | null;
  stack?: string | null;
  jobSnapshot?: JobSnapshot | null;
}

export interface FitCheckDeps {
  store: Store;
  loader: SkillLoader;
  llm: LlmClient;
  scrape?: (url: string, deps?: ScrapeDeps) => Promise<ScrapedJob>;
  scrapeDeps?: ScrapeDeps;
}

export interface FitCheckResult {
  needsManualContent?: boolean;
  manualContentReason?: string;
  scrapedChars?: number;
  url?: string;
  job: JobSnapshot;
  detectedLanguage: 'pt-br' | 'en';
  suggestedLanguage: 'pt-br' | 'en';
  needsLanguageConfirmation: boolean;
  needsFitConfirmation: boolean;
  eligibilityBlocked: boolean;
  fit: Fit | null;
  jobSnapshot: JobSnapshot;
}

interface ResolvedJobData {
  url: string;
  title: string;
  company: string;
  location: string;
  applyUrl: string;
  detectedLanguage: 'pt-br' | 'en';
  content: string;
  extraQuestions: string;
  recruiterMessage: string;
  fromCache?: boolean;
}

function resolveJobData(
  input: FitCheckInput,
  scraped: ScrapedJob | null,
): ResolvedJobData {
  const snapshot = input.jobSnapshot;
  if (snapshot?.content) {
    return {
      url: snapshot.url || input.url || '',
      title: snapshot.title || 'Vaga',
      company: snapshot.company || 'Empresa',
      location: snapshot.location || '',
      applyUrl: snapshot.applyUrl || snapshot.url || input.url || '',
      detectedLanguage: normalizeLang(snapshot.detectedLanguage),
      content: snapshot.content,
      extraQuestions: snapshot.extraQuestions || input.extraQuestions || '',
      recruiterMessage: snapshot.recruiterMessage || input.recruiterMessage || '',
      fromCache: true,
    };
  }
  if (scraped) {
    return {
      ...scraped,
      detectedLanguage: normalizeLang(scraped.detectedLanguage),
      extraQuestions: input.extraQuestions || '',
      recruiterMessage: input.recruiterMessage || '',
    };
  }
  const rawText = String(input.rawText ?? '');
  return {
    url: input.url || '',
    title: 'Vaga Manual',
    company: 'Empresa',
    location: '',
    applyUrl: input.url || '',
    content: rawText || input.url || '',
    extraQuestions: input.extraQuestions || '',
    recruiterMessage: input.recruiterMessage || '',
    detectedLanguage: detectLangFromText(rawText),
  };
}

function parseLlmJson(raw: string): Record<string, unknown> {
  let text = (raw || '').trim();
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function buildFitPrompt(
  jobData: ResolvedJobData,
  detected: 'pt-br' | 'en',
  profile: ResolvedProfile,
  requirements: ClassifiedRequirements,
): string {
  const mustLines = (
    requirements.mustHave.length
      ? requirements.mustHave
      : ['(não detectado por regex — classifique você)']
  )
    .map((line) => `- ${line}`)
    .join('\n');
  const diffLines = (
    requirements.differentials.length
      ? requirements.differentials
      : ['(nenhum diferencial explícito detectado)']
  )
    .map((line) => `- ${line}`)
    .join('\n');

  return `
Analise a vaga contra o Currículo Base (FONTE INEGOCIÁVEL DE FATOS) seguindo o framework da skill.

=== VAGA ===
Título/Empresa: ${jobData.title} | ${jobData.company}
URL: ${jobData.url}
Idioma detectado no anúncio: ${detected}
Descrição:
${truncate(jobData.content, PROMPT_JOB_LIMIT)}
${jobData.extraQuestions ? `\nPerguntas extras informadas pelo candidato (use como contexto adicional):\n${truncate(jobData.extraQuestions, PROMPT_EXTRA_LIMIT)}` : ''}
${jobData.recruiterMessage ? `\nMensagem do recrutador (LinkedIn/WhatsApp/e-mail, colada pelo candidato — use para entender o contexto da abordagem, NÃO invente fatos além do base):\n${truncate(jobData.recruiterMessage, PROMPT_EXTRA_LIMIT)}` : ''}

=== PERFIL CALCULADO POR SCRIPT (DETERMINÍSTICO — NÃO RECALCULE, NÃO SOME DATAS) ===
${getProfileSection(profile.rawText)}
Tempo total a citar no fitAnalysis: 10+ anos (o base declara 10+; nunca escreva outro número de anos totais).

=== REQUISITOS PRÉ-CLASSIFICADOS POR SCRIPT (confirme e ajuste se necessário) ===
Must-have:
${mustLines}
Diferenciais (ausência = "não demonstrado", NUNCA "sem experiência"):
${diffLines}

=== REGRAS DE JULGAMENTO (OBRIGATÓRIAS) ===
- Gap crítico SOMENTE em must-have explícito com magnitude (ex: "5+ years serving millions"). Diferencial ausente = aderência parcial, nunca gap eliminatório.
- NUNCA alegue experiência formal como entrevistador/hiring-manager/avaliador ("interviewing/evaluating engineers", "Go/No-Go", "Scouting Report") salvo se o base contiver esses fatos. Mentoria e code review são evidência transferível, não equivalência — registre como "transferível", nunca como experiência formal cumprida.
- Escala sem métricas no CV = "não quantificado" (parcial), nunca "sem experiência em escala".
- Cada strength/gap deve citar fato do PERFIL ou do CV acima.
- ÂNCORAS NUMÉRICAS (siga à risca, sem exceção silenciosa):
  - skillsMatch: stack principal da vaga com 2+ blocos de evidência no PERFIL → ≥ 70; PROIBIDO < 50 nesse caso. Abaixo de 50 só com must-have sem nenhuma evidência.
  - experienceMatch: tempo total ≥ exigido pela vaga → ≥ 70. "Overqualified" (ex: vaga 2-5 anos, candidato 9+) NUNCA derruba abaixo de 50 — registre como nota, não como penalidade.
  - logisticsMatch: vaga remota + candidato em país elegível sem restrição de visto → ≥ 70. Baixo (< 50) só com incompatibilidade real (presencial noutra cidade/país sem relocação, fuso incompatível exigido).
  - cultureMatch: histórico em times ágeis/multidisciplinares → base 60; abaixo de 50 só com evidência contrária explícita no CV.
  - PROIBIDO qualquer dimensão < 20 sem citar o fato impeditivo concreto.
- AUTO-CHECAGEM FINAL (antes de responder): calcule 0.4·skills + 0.3·exp + 0.2·log + 0.1·cult; se divergir mais de 10 pontos do fitRating, REVISE os números até convergir.

=== CURRÍCULO BASE (COMPLETO — considere TODA a trajetória, do primeiro ao último cargo) ===
${truncate(profile.rawText, PROMPT_RESUME_LIMIT)}

=== SAÍDA (JSON válido, sem markdown) ===
{
  "company": "Nome limpo da empresa",
  "role": "Nome do cargo",
  "eligibility": { "passed": true, "reason": "Ex: sem exigência de cidadania/visto restritivo" },
  "languageGate": { "required": "pt-br|en", "passed": true, "note": "Ex: vaga em inglês, candidato nível profissional" },
  "skillsMatch": 0,
  "experienceMatch": 0,
  "logisticsMatch": 0,
  "cultureMatch": 0,
  "fitRating": 0,
  "fitAnalysis": "2-3 frases: compatibilidade técnica + lacunas honestas",
  "strengths": ["ponto forte 1", "ponto forte 2"],
  "gaps": ["lacuna honesta 1"],
  "recommendation": "proceed | proceed_with_focus | ask_user"
}`;
}

export async function checkJobFit(
  deps: FitCheckDeps,
  input: FitCheckInput,
): Promise<FitCheckResult> {
  const baseStack = normalizeStack(input.stack);
  const cleanerExtra = truncate(input.extraQuestions, EXTRA_TEXT_LIMIT);
  const cleanerRecruiter = truncate(input.recruiterMessage, EXTRA_TEXT_LIMIT);
  const scrape = deps.scrape ?? scrapeJob;

  let scraped: ScrapedJob | null = null;
  const hasSnapshotContent = Boolean(input.jobSnapshot?.content);
  if (!hasSnapshotContent && input.url && input.url.startsWith('http')) {
    scraped = await scrape(input.url, deps.scrapeDeps);
  }
  let jobData = resolveJobData(
    { ...input, extraQuestions: cleanerExtra, recruiterMessage: cleanerRecruiter },
    scraped,
  );

  // Thin scraped content: pasted text in the same request wins; otherwise ask
  // for it instead of returning a silent 0% fit.
  if (isJobContentThin(jobData.content)) {
    const pasted = String(input.rawText ?? '').trim();
    if (!isJobContentThin(pasted)) {
      jobData = {
        ...jobData,
        content: pasted,
        detectedLanguage: detectLangFromText(pasted),
      };
    } else {
      const detected = normalizeLang(jobData.detectedLanguage || 'pt-br');
      const job: JobSnapshot = {
        title: jobData.title,
        company: jobData.company,
        location: jobData.location || '',
        url: jobData.url,
        applyUrl: jobData.applyUrl || jobData.url,
        detectedLanguage: detected,
      };
      return {
        needsManualContent: true,
        manualContentReason: THIN_CONTENT_REASON,
        scrapedChars: String(jobData.content || '').trim().length,
        url: jobData.url || input.url || '',
        job,
        detectedLanguage: detected,
        suggestedLanguage: detected,
        needsLanguageConfirmation: true,
        needsFitConfirmation: false,
        eligibilityBlocked: false,
        fit: null,
        jobSnapshot: {
          ...job,
          content: truncate(jobData.content, JOB_CONTENT_LIMIT),
          extraQuestions: truncate(jobData.extraQuestions, EXTRA_TEXT_LIMIT),
          recruiterMessage: truncate(jobData.recruiterMessage, EXTRA_TEXT_LIMIT),
          contentThin: true,
        },
      };
    }
  }

  const detected = normalizeLang(jobData.detectedLanguage || 'pt-br');
  const requested =
    input.languagePreference && input.languagePreference !== 'auto'
      ? normalizeLang(input.languagePreference)
      : null;
  const suggestedLanguage = requested || detected;
  const needsLanguageConfirmation = !requested;

  const profile = resolveProfileWithFallback(
    deps.store,
    baseStack,
    suggestedLanguage,
  );
  if (!profile) {
    throw new Error(
      'Nenhum currículo base habilitado encontrado. Habilite um alvo na aba Admin (App Settings) e tente novamente.',
    );
  }

  const requirements = classifyRequirements(jobData.content || '');
  const { fitSystem } = targetSystemPrompts(deps.loader, profile.profile);
  const prompt = buildFitPrompt(jobData, detected, profile, requirements);
  const raw = await deps.llm.call(prompt, fitSystem);

  let parsed: Record<string, unknown>;
  try {
    parsed = parseLlmJson(raw);
  } catch (err) {
    throw new Error(
      `A resposta da IA (fit-check) não veio em JSON válido: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const fitRating = Number(parsed.fitRating || 0);
  const eligibility = parsed.eligibility as
    | { passed?: boolean; reason?: string }
    | undefined;
  const languageGate = parsed.languageGate as
    | { required?: string; passed?: boolean; note?: string | null }
    | undefined;
  const eligibilityBlocked = eligibility?.passed === false;
  const recommendation =
    typeof parsed.recommendation === 'string' ? parsed.recommendation : '';
  const needsFitConfirmation =
    eligibilityBlocked || fitRating < 50 || recommendation === 'ask_user';

  const fit: Fit = {
    rating: fitRating,
    analysis: typeof parsed.fitAnalysis === 'string' ? parsed.fitAnalysis : '',
    dimensions: {
      skillsMatch: Number(parsed.skillsMatch || 0),
      experienceMatch: Number(parsed.experienceMatch || 0),
      logisticsMatch: Number(parsed.logisticsMatch || 0),
      cultureMatch: Number(parsed.cultureMatch || 0),
    },
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.map(String)
      : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
    eligibility: {
      passed: eligibility?.passed ?? true,
      reason: eligibility?.reason ?? '',
    },
    languageGate: {
      required: languageGate?.required ?? detected,
      passed: languageGate?.passed ?? true,
      note: languageGate?.note ?? null,
    },
    logisticsNote: detectLogisticsNote(jobData),
  };

  const job: JobSnapshot = {
    title: jobData.title,
    company:
      typeof parsed.company === 'string' && parsed.company
        ? parsed.company
        : jobData.company,
    location: jobData.location || '',
    url: jobData.url,
    applyUrl: jobData.applyUrl || jobData.url,
    detectedLanguage: detected,
  };

  return {
    job,
    detectedLanguage: detected,
    suggestedLanguage,
    needsLanguageConfirmation,
    needsFitConfirmation,
    eligibilityBlocked,
    fit,
    jobSnapshot: {
      ...job,
      content: truncate(jobData.content, JOB_CONTENT_LIMIT),
      extraQuestions: truncate(jobData.extraQuestions, EXTRA_TEXT_LIMIT),
      recruiterMessage: truncate(jobData.recruiterMessage, EXTRA_TEXT_LIMIT),
    },
  };
}
