import type { Fit } from '../../domain/job.js';
import type { JobSnapshot, LlmQuestion } from '../../domain/run.js';
import { NEEDS_INPUT_ANSWER_LIMIT, NEEDS_INPUT_MAX_ROUNDS } from '../../domain/run.js';
import {
  detectLangFromText,
  normalizeLang,
  normalizeStack,
  PROMPT_EXTRA_LIMIT,
  PROMPT_JOB_LIMIT,
  PROMPT_RESUME_LIMIT,
} from '../content.js';
import {
  analyzeProfile,
  extractCoverageTerms,
  formatProfileSection,
  type CoverageTerms,
} from '../fit/profile.js';
import type { LlmClient } from '../llm/client.js';
import { accentFor, type PdfTheme } from '../pdf-theme.js';
import { withExtraPrompt } from '../prompts.js';
import type { ResolvedProfile } from '../profiles.js';
import type { SkillLoader } from '../skills/loader.js';
import {
  extractAmmoNumbers,
  validateResumeContent,
  validateResumeHtml,
  type Violation,
} from './validate.js';

/**
 * Phase-2 kit generation (port of v1 `processJob`, steps 1-5b) as pure steps:
 * resolve the posting, build the prompt, parse the kit or an input request,
 * validate and retry at most twice. File/PDF/artifact writing lives in
 * `kit/artifacts.ts` (T3.6) so this module stays testable without I/O.
 */

export const KIT_FIX_ATTEMPTS = 2;

/* ----------------------------- job context ----------------------------- */

export interface KitJobData {
  title: string;
  company: string;
  location: string;
  url: string;
  applyUrl: string;
  detectedLanguage: string;
  content: string;
  extraQuestions: string;
  recruiterMessage: string;
}

export interface ResolveKitJobInput {
  jobSnapshot?: JobSnapshot | null;
  url?: string | null;
  rawText?: string | null;
  extraQuestions?: string | null;
  recruiterMessage?: string | null;
}

/**
 * Resolves the posting without scraping: the fit-check already stored the
 * snapshot on the run, and pasted text covers the manual path. A URL alone is
 * not enough — the caller must have scraped or asked for the text first.
 */
export function resolveKitJobData(input: ResolveKitJobInput): KitJobData {
  const snapshot = input.jobSnapshot;
  if (snapshot?.content) {
    return {
      title: snapshot.title || 'Vaga',
      company: snapshot.company || 'Empresa',
      location: snapshot.location || '',
      url: snapshot.url || input.url || '',
      applyUrl: snapshot.applyUrl || snapshot.url || input.url || '',
      detectedLanguage: normalizeLang(snapshot.detectedLanguage || 'pt-br'),
      content: snapshot.content,
      extraQuestions: snapshot.extraQuestions || input.extraQuestions || '',
      recruiterMessage: snapshot.recruiterMessage || input.recruiterMessage || '',
    };
  }

  const pasted = String(input.rawText ?? '').trim();
  if (pasted) {
    return {
      title: 'Vaga Manual',
      company: 'Empresa',
      location: '',
      url: input.url || '',
      applyUrl: input.url || '',
      detectedLanguage: detectLangFromText(pasted),
      content: pasted,
      extraQuestions: String(input.extraQuestions ?? ''),
      recruiterMessage: String(input.recruiterMessage ?? ''),
    };
  }

  throw new Error(
    'Sem conteúdo da vaga: nenhum snapshot raspado nem texto colado para gerar o kit.',
  );
}

/* -------------------------- needsInput envelope ------------------------- */

export const NEEDS_INPUT_EXCERPT_LIMIT = 500;

export type NeedsInputKind = 'missing_fact' | 'inference_approval';

export interface NeedsInputEnvelope extends LlmQuestion {
  kind: NeedsInputKind;
}

function stripLlmFences(raw: unknown): string {
  let text = String(raw ?? '').trim();
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return text;
}

/**
 * Validates the `{needsInput: true, ...}` envelope before it reaches the UI:
 * only `confidence: 'high'` inferences are offered, never numeric ones.
 */
export function validateNeedsInputPayload(
  obj: Record<string, unknown>,
  raw = '',
): LlmQuestion {
  if (!obj || obj.needsInput !== true) {
    throw new Error('Envelope needsInput inválido: needsInput !== true.');
  }
  const question = String(obj.question ?? '').trim();
  if (!question) throw new Error('Envelope needsInput inválido: question vazia.');
  if (question.length > NEEDS_INPUT_ANSWER_LIMIT) {
    throw new Error('Envelope needsInput inválido: question excede o limite.');
  }

  const options = Array.isArray(obj.options)
    ? obj.options
        .map((option) => String(option ?? '').trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((option) => option.slice(0, 200))
    : [];
  const blockingField = String(obj.blockingField ?? '').slice(0, 200);
  const rawKind =
    obj.kind === undefined || obj.kind === null || obj.kind === ''
      ? 'missing_fact'
      : String(obj.kind);
  if (rawKind !== 'missing_fact' && rawKind !== 'inference_approval') {
    throw new Error(`Envelope needsInput inválido: kind "${rawKind}" desconhecido.`);
  }

  const inferences: LlmQuestion['inferences'] = [];
  if (rawKind === 'inference_approval') {
    const list = Array.isArray(obj.inferences) ? obj.inferences : [];
    if (list.length === 0) {
      throw new Error(
        'Envelope inference_approval inválido: inferences[] ausente ou vazio.',
      );
    }
    if (list.length > 5) {
      throw new Error(
        'Envelope inference_approval inválido: máx. 5 inferências por rodada.',
      );
    }
    list.forEach((item, index) => {
      const inference = (item ?? {}) as Record<string, unknown>;
      const skill = String(inference.skill ?? '').trim().slice(0, 80);
      const inferredFrom = String(inference.inferredFrom ?? '').trim().slice(0, 80);
      const confidence = String(inference.confidence ?? '').trim().toLowerCase();
      if (!skill || !inferredFrom) {
        throw new Error(
          `Inferência #${index + 1} inválida: skill/inferredFrom obrigatórios.`,
        );
      }
      if (confidence !== 'high') {
        throw new Error(
          `Inferência "${skill}" rejeitada: só confidence "high" chega à UI (recebido "${confidence || 'ausente'}").`,
        );
      }
      if (/\d+\s*(anos?|years?|meses?|months?|%)/i.test(`${skill} ${question}`)) {
        throw new Error(
          `Inferência "${skill}" rejeitada: nenhuma inferência numérica (anos/métricas) é permitida.`,
        );
      }
      inferences.push({ skill, inferredFrom, confidence: 'high' });
    });
  } else if (obj.inferences !== undefined && obj.inferences !== null) {
    throw new Error('Envelope missing_fact não deve conter inferences[].');
  }

  return {
    question: question.slice(0, NEEDS_INPUT_ANSWER_LIMIT),
    options,
    blockingField,
    kind: rawKind,
    inferences,
    rawExcerpt: String(raw ?? '').slice(0, NEEDS_INPUT_EXCERPT_LIMIT),
  };
}

/** Rejects inferences whose `inferredFrom` is not literally in the base resume. */
export function assertInferencesGrounded(
  inferences: LlmQuestion['inferences'],
  baseRawText: unknown,
): void {
  const base = String(baseRawText ?? '').toLowerCase();
  for (const inference of inferences ?? []) {
    if (!inference.inferredFrom || !base.includes(inference.inferredFrom.toLowerCase())) {
      throw new Error(
        `Inferência "${inference.skill}" rejeitada: "${inference.inferredFrom}" não consta no currículo base.`,
      );
    }
  }
}

export type ParsedKitResponse =
  | { type: 'kit'; data: Record<string, unknown> }
  | ({ type: 'needs_input' } & LlmQuestion);

function genericNeedsInput(raw: unknown, reason?: string): ParsedKitResponse {
  return {
    type: 'needs_input',
    question:
      reason ||
      'A IA retornou uma resposta fora do formato JSON do kit e precisa de uma clarificação para continuar. Veja o trecho e informe como prosseguir (ou descarte o processo).',
    options: [],
    blockingField: '',
    kind: 'missing_fact',
    inferences: [],
    rawExcerpt: String(raw ?? '').slice(0, NEEDS_INPUT_EXCERPT_LIMIT),
  };
}

/**
 * Tolerant kit parser: fenced JSON is accepted, `needsInput` becomes a
 * question, and anything else becomes a generic clarification request.
 */
export function parseKitOrQuestion(raw: unknown): ParsedKitResponse {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripLlmFences(raw)) as Record<string, unknown>;
  } catch {
    return genericNeedsInput(raw);
  }
  if (obj && obj.needsInput === true) {
    return { type: 'needs_input', ...validateNeedsInputPayload(obj, String(raw ?? '')) };
  }
  if (
    obj &&
    typeof obj.tailoredResumeHtml === 'string' &&
    obj.tailoredResumeHtml.length > 0
  ) {
    return { type: 'kit', data: obj };
  }
  return genericNeedsInput(
    raw,
    'A IA retornou um JSON fora do formato do kit (sem tailoredResumeHtml nem needsInput). Informe como prosseguir (ou descarte o processo).',
  );
}

/* ------------------------------- prompts ------------------------------- */

export interface KitPromptInput {
  job: KitJobData;
  baseRawText: string;
  stack: string;
  language: string;
  theme: PdfTheme;
  fit?: Fit | null;
  fitConfirmed?: boolean;
  userAnswer?: string | null;
  approvedInferences?: string[];
  rejectedInferences?: string[];
  coverLetterGuidance?: string | null;
  /** Free-form notes applied to the regenerated materials. */
  artifactGuidance?: string | null;
  /** `resume_style.css` from the skill templates (embedded in the prompt). */
  cssContent?: string;
  /** Live email style guide section (skill reference). */
  emailSection?: string;
}

export interface KitPrompt {
  prompt: string;
  accent: string;
  coverage: CoverageTerms;
  ammoNumbers: string[];
  language: 'pt-br' | 'en';
  stack: 'ruby' | 'php';
}

/** Resume blocks injected into the generation prompt (§3.4 / §3.6.3). */
export function buildClarificationSection(
  input: Pick<
    KitPromptInput,
    'userAnswer' | 'approvedInferences' | 'rejectedInferences'
  > = {},
): string {
  const parts: string[] = [];
  const answer = String(input.userAnswer ?? '')
    .trim()
    .slice(0, NEEDS_INPUT_ANSWER_LIMIT);
  if (answer) {
    parts.push(
      `=== USER_CLARIFICATION (fato fornecido pelo usuário) ===\n${answer}\nTrate acima como FATO fornecido pelo usuário para esta vaga. Não invente além dele.`,
    );
  }
  const approved = (input.approvedInferences ?? [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (approved.length > 0) {
    parts.push(
      `=== USER_APPROVED_INFERENCES (aprovadas pelo usuário, usar só onde houver correspondência genuína) ===\nAprovadas: ${approved.join(', ')}\nVocê pode citar as aprovadas nos Highlights/bullets onde a vaga pedir e houver correspondência genuína com a tecnologia pai do base. Nunca invente métricas, anos de experiência, empresas ou certificações a partir delas. Andam separadas: NÃO as apresente como fatos do currículo base.`,
    );
  }
  const rejected = (input.rejectedInferences ?? [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 10);
  if (rejected.length > 0) {
    parts.push(
      `NUNCA liste (rejeitadas pelo usuário, proibidas nesta retomada): ${rejected.join(', ')}. Não reinsista nelas nem as reembale como fato do base.`,
    );
  }
  return parts.join('\n\n');
}

function coverageBlock(coverage: CoverageTerms): string {
  const must =
    coverage.mustCover
      .map(
        (term) =>
          `- ${term.term} (vaga: "${term.jobSnippet ?? ''}"; use o caso de uso do base: "${term.baseSnippet ?? ''}")`,
      )
      .join('\n') ||
    '- (nenhum match técnico detectado por regex — use as keywords da vaga com grounding no base)';
  const forbidden =
    coverage.forbidden
      .map((term) => `- ${term.term} (vaga cita, base NÃO tem — PROIBIDO no kit)`)
      .join('\n') || '- (nenhum veto)';
  const core =
    coverage.coreKept
      .map((term) => `- ${term.term} (${term.baseHits ?? 0} menções no base)`)
      .join('\n') || '- (nenhum)';

  return `=== COBERTURA OBRIGATÓRIA (verificada por script após gerar — ausência = falha de geração) ===
Matches genuínos vaga+base. TODOS devem aparecer no tailoredResumeHtml (Highlights ou bullets com contexto real, nunca soltos):
${must}
VETOS DE GROUNDING (se algum aparecer no kit, a geração falha — remover):
${forbidden}
=== NÚCLEO PRESERVADO (assinatura do candidato) ===
Mesmo que a vaga não cite, estes itens são o núcleo do candidato — mantenha nos Highlights. O teto de cargos/experiências NÃO autoriza remover ferramentas do Highlights:
${core}`;
}

function accentCss(accent: string, accentDark: string): string {
  return `:root{--accent:${accent};--accent-dark:${accentDark};}.accent{height:8px;background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;}h2.section-title,.section-title{border-top:2px solid ${accent};border-bottom:none !important;padding-top:12px;}.contact-info a,.contact a{color:${accentDark};}`;
}

/**
 * Builds the tailor prompt: fit context, clarification, posting, base resume,
 * deterministic coverage/ammo, stage method, layout and output contract.
 */
export function buildKitPrompt(input: KitPromptInput): KitPrompt {
  const stack = normalizeStack(input.stack) as 'ruby' | 'php';
  const language = normalizeLang(input.language);
  const isEn = language === 'en';
  const accent = accentFor(input.theme, stack);
  const dark = (input.theme[stack]?.accentDark || input.theme.ruby.accentDark).toUpperCase();
  const css = `${input.cssContent ?? ''}\n${accentCss(accent, dark)}`;

  const analyzed = analyzeProfile(input.baseRawText);
  const ammoSection = formatProfileSection(analyzed);
  // Computed durations of an empty career ("0m") are not ammunition.
  const ammoNumbers = analyzed.jobs > 0 ? extractAmmoNumbers(ammoSection) : [];
  const coverage = extractCoverageTerms(
    input.job.content || '',
    input.baseRawText || '',
  );

  const fit = input.fit;
  const fitContext = fit
    ? `
=== FIT APROVADO PELO USUÁRIO (fase 1 da skill) ===
fitRating: ${fit.rating ?? ''}
Pontos fortes: ${(fit.strengths ?? []).join(' | ').slice(0, 800)}
Lacunas honestas (NÃO mascare, NÃO invente para cobri-las): ${(fit.gaps ?? []).join(' | ').slice(0, 800)}
Elegibilidade: ${JSON.stringify(fit.eligibility ?? {}).slice(0, 300)}
`
    : '';
  const clarification = buildClarificationSection(input);
  const clarificationBlock = clarification ? `\n${clarification}\n` : '';

  const guidance = String(input.coverLetterGuidance ?? '').trim().slice(0, 2000);
  const guidanceBlock = guidance
    ? `
=== DIRECIONAMENTO DO USUÁRIO PARA A COVER LETTER (OBRIGATÓRIO — seguir com fatos do base) ===
${guidance}
REGRAS DE APLICAÇÃO (sem exceção silenciosa):
1. Extraia 1-3 diretivas acionáveis do texto acima (ponto a destacar, tom, grau de formalidade). Texto colado de páginas institucionais vale só como contexto de tom — não copie slogans.
2. Aplique CADA diretiva na coverLetterHtml usando SOMENTE fatos reais do Currículo Base sobre o tema nomeado. Sem métricas novas, sem fatos fora do base.
3. Use o direcionamento também para PRIORIZAR ênfases no tailoredResumeHtml — sem inventar fatos.
4. Se alguma diretiva não tiver respaldo no base, omita-a em vez de inventar.
`
    : '';

  const revision = String(input.artifactGuidance ?? '').trim().slice(0, 2000);
  const revisionBlock = revision
    ? `
=== CONSIDERAÇÕES DO USUÁRIO PARA ESTA VERSÃO (aplicar só com fatos do base) ===
${revision}
Aplique as considerações acima aos materiais sendo gerados, priorizando o arquivo pedido. Se algo não tiver respaldo no Currículo Base, omita em vez de inventar; não crie métricas, empresas ou certificações novas.
`
    : '';

  const job = input.job;
  const prompt = `
Analise a seguinte vaga e o currículo base do candidato.
${fitContext}${clarificationBlock}${revisionBlock}
=== VAGA DE EMPREGO ===
Título/Empresa: ${job.title} | ${job.company}
URL: ${job.url}
Descrição e Requisitos:
${(job.content || '').slice(0, PROMPT_JOB_LIMIT)}
${job.extraQuestions ? `\nPerguntas extras do formulário (considere ao personalizar os materiais):\n${job.extraQuestions.slice(0, PROMPT_EXTRA_LIMIT)}` : ''}
${job.recruiterMessage ? `\nMENSAGEM DO RECRUTADOR (abordagem via LinkedIn/WhatsApp/e-mail, colada pelo candidato):\n${job.recruiterMessage.slice(0, PROMPT_EXTRA_LIMIT)}\nUse-a para personalizar linkedInConnectionNote/linkedInInMail como RESPOSTA (tom de retorno, não prospecção fria). Nunca invente fatos além do base.` : ''}

=== CURRÍCULO BASE DO CANDIDATO (FONTE INEGOCIÁVEL DE FATOS — COMPLETO) ===
${String(input.baseRawText ?? '').slice(0, PROMPT_RESUME_LIMIT)}

=== MUNIÇÃO PARA BULLETS (fatos reais do script — USE estes números e casos nos bullets) ===
${ammoSection}
${coverageBlock(coverage)}

=== MÉTODO EM ESTÁGIOS (siga internamente, nesta ordem) ===
ESTÁGIO 1 — CANDIDATO: extraia do base skills, cargos, domínios, números e ferramentas reais. Nada fora daqui existe.
ESTÁGIO 2 — VAGA: extraia requisitos, responsabilidades, senioridade, domínio e sinais. A COBERTURA OBRIGATÓRIA acima já fez o cruzamento técnico — confie nela, não re-deriva.
ESTÁGIO 3 — MAPEAMENTO: para cada requisito, 1 evidência real do base.
ESTÁGIO 4 — PRIORIZAÇÃO: ordene por relevância para ESTA vaga, mais forte primeiro em cada seção.
ESTÁGIO 5 — ESCRITA: bullets com DENSIDADE DE EVIDÊNCIA (AÇÃO + TECNOLOGIA + PROBLEMA/CONTEXTO + RESULTADO/IMPACTO) sempre que o base sustentar. Sem número real, use ESCOPO — nunca invente métrica.
ESTÁGIO 6 — VALIDAÇÃO: confira cada claim contra o base e contra os VETOS; nada inventado; identidade do candidato preservada.

=== GUARDAS DE IDENTIDADE (inegociáveis) ===
- Full-stack com ênfase backend/Rails: nunca apresente como backend-only.
- React Native (mobile) NÃO é React web: nunca liste React como skill web.
- ElastiCache não é Redis standalone; cite só o que o base comprova.
- Não alegue on-call, experiência formal como entrevistador/hiring manager, agentes/LLM-infra/RAG ou treino de modelos sem fato no base.
- A experiência mais recente é a mais relevante para esta vaga: bullets mais detalhados.

=== ENGENHARIA DO CV (OBRIGATÓRIA — olho do recrutador: 6-10s de scan) ===
- target-title: wording EXATO da vaga, nunca genérico.
- Summary (3-4 linhas): senioridade + stack + 1-2 provas de escala com NÚMEROS da munição + diferencial relevante. PROIBIDO clichês sem prova ("proven track record", "passionate", "results-driven", "seasoned").
- Bullets (3-4 por cargo): verbo forte + ESCOPO/ESCALA + resultado. Todo cargo abre com 1 bullet de escopo.
- Highlights (10-12): UM parágrafo com classe skills e grupos <strong>Categoria:</strong> separados por |. PROIBIDO pills/badges com classe skill.
- Números só da MUNIÇÃO/CV — nunca inventar métrica.

=== SELEÇÃO DE EXPERIÊNCIAS (OBRIGATÓRIA) ===
- Bullets completos (3-4 cada) em no máximo 5-6 cargos relevantes, ordenados por relevância.
- MÍNIMOS: pelo menos 4-5 cargos com bullets cobrindo o período recente sem buracos; 10-12 skills nos Highlights; Summary substantivo. Nunca corte evidência sênior para caber em 2 páginas.
- Cargos antigos condensados em 1 bloco "Early Career" (só cargo/empresa/período, sem bullets).

=== FORMAÇÃO & CERTIFICAÇÕES (OBRIGATÓRIA — sempre inclua) ===
- Seção "Education & Certifications" (EN) ou "Formação & Certificações" (PT-BR) com formação acadêmica E certificações extraídas do Currículo Base.
- Traduza nomes de cursos para o inglês quando o currículo for em inglês; mantenha em português quando for PT-BR.
- Estrutura: <div class="edu-entry"><div class="edu-degree">…</div><div class="edu-school">…</div></div>. NÃO OMITA certificações.

=== INSTRUÇÕES DE SAÍDA ===
Gere um JSON com o seguinte formato:
{
  "company": "Nome limpo da empresa",
  "role": "Nome do cargo",
  "fitRating": 85,
  "fitAnalysis": "Resumo conciso de 2-3 frases analisando a compatibilidade técnica e eventuais lacunas honestas",
  "tailoredResumeHtml": "<!DOCTYPE html><html>... HTML completo e autocontido no idioma ${isEn ? 'Inglês' : 'Português (PT-BR)'}, com a tag <style>${css.replace(/</g, '&lt;')}</style> embutida. LAYOUT OBRIGATÓRIO (layout B, coluna única, ATS): <div class=\\"accent\\"></div> como PRIMEIRO filho de <body>, exatamente 1 faixa, cor ${accent} (stack ${stack}, --accent); header empilhado (h1.candidate-name + div.target-title + div.location-line + div.contact-info); seções Summary, Highlights (UM p.skills com grupos <strong>Categoria:</strong> separados por | — PROIBIDO pills .skill), Experience (cada job: h3, div.meta, ul.clean), Education & Certifications, footer de idiomas; h2.section-title com border-top 2px solid ${accent} e SEM border-bottom. Use exatamente estas classes: resume-container, candidate-name, target-title, location-line, contact-info, section-title, summary-text, skills, job-entry, job-title, job-company, job-meta, bullet-list, edu-entry, edu-degree, edu-school, languages. Nenhum <link>/<img>/fonte remota...</html>",
  "coverLetterHtml": "<!DOCTYPE html><html>... Carta de apresentação no idioma ${isEn ? 'Inglês' : 'Português (PT-BR)'} seguindo ESTRITAMENTE a filosofia COVER-LETTER-COMPANY-FIRST abaixo...</html>",
  "emailSubject": "Assunto simples e profissional (ex: 'Application: [Cargo] – [Nome]'), sem autopromoção",
  "emailBody": "E-mail de candidatura seguindo a filosofia EMAIL-WRITER (150-250 palavras, humano, específico da vaga)",
  "emailNotes": "1-2 frases: quais sinais da vaga guiaram a personalização do e-mail",
  "linkedInConnectionNote": "Nota de conexão de até 300 caracteres para o recrutador",
  "linkedInInMail": "Mensagem direta de 100-150 palavras para o recrutador"
}
ALTERNATIVA — PEDIDO DE INPUT (fila interativa): se (e somente se) faltar um dado que impeça o kit, retorne APENAS {"needsInput": true, "question": "...", "options": [...], "blockingField": "..."} (ou kind "inference_approval" com inferences[]). Nunca misture kit + needsInput. Nada de texto fora do JSON.

=== FILOSOFIA COVER-LETTER-COMPANY-FIRST (OBRIGATÓRIA) ===
Uma cover letter ruim parece o currículo reescrito em parágrafo. ISSO É PROIBIDO.
NUNCA abra com: "Tenho X anos de experiência" / "Trabalhei com Y" / "Sei React, Node, AWS" / "Sou full stack".
Uma boa cover letter começa com A EMPRESA, não com o candidato: 1. Por que essa empresa? 2. Por que esse produto? 3. Por que você faz sentido ali?
ESTRUTURA OBRIGATÓRIA (3-4 parágrafos curtos, 200-300 palavras, mesmo idioma do currículo):
- P1 (HOOK ESPECÍFICO): mostre que escolheu a empresa de propósito, reagindo a 1-2 detalhes REAIS da descrição da vaga.
- P2 (CONEXÃO): conecte UMA experiência real do Currículo Base que resolve o problema da empresa, com contexto + resultado, no máximo 1 número. Sem catálogo de tecnologias.
- P3 (FECHAMENTO): fit honesto + call to action simples. Sem bajulação, sem clichês.
- PROIBIDO: parágrafo-catálogo de tecnologias, reescrever bullets do CV, frases genéricas que serviriam para qualquer empresa.
- GROUNDING MANTIDO: nada de inventar produto, métrica ou experiência.
${guidanceBlock}${input.emailSection ?? ''}
`;

  return { prompt, accent, coverage, ammoNumbers, language, stack };
}

/* ----------------------------- generation ------------------------------ */

export interface KitData {
  company: string;
  role: string;
  fitRating: number;
  fitAnalysis: string;
  resumeHtml: string;
  coverLetterHtml: string | null;
  emailSubject: string;
  emailBody: string;
  emailNotes: string;
  linkedInConnectionNote: string;
  linkedInInMail: string;
}

export interface KitValidation {
  attempts: number;
  ok: boolean;
  hardViolations: Violation[];
  warnings: Violation[];
}

export interface GenerateKitInput {
  job: KitJobData;
  stack: string;
  language: string;
  fit?: Fit | null;
  fitConfirmed?: boolean;
  needsInputRounds?: number;
  userAnswer?: string | null;
  approvedInferences?: string[];
  rejectedInferences?: string[];
  coverLetterGuidance?: string | null;
  /** Free-form notes applied to the regenerated materials. */
  artifactGuidance?: string | null;
}

export interface KitGenerationDeps {
  llm: LlmClient;
  loader: SkillLoader;
  /** Enabled target profile (base resume is the source of truth). */
  profile: ResolvedProfile;
  theme: PdfTheme;
  /** Skill template read by the caller; defaults to the loader's template. */
  cssContent?: string;
  fixAttempts?: number;
  warn?: (message: string) => void;
}

export type GenerateKitResult =
  | {
      status: 'done';
      kit: KitData;
      accent: string;
      coverage: CoverageTerms;
      ammoNumbers: string[];
      validation: KitValidation;
    }
  | {
      status: 'needs_input';
      question: LlmQuestion;
      needsInputRounds: number;
      stack: string;
      language: 'pt-br' | 'en';
    }
  | { status: 'failed'; error: string; validation?: KitValidation };

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Deterministic layout + content checks over one kit HTML. */
function runChecks(
  html: string,
  input: { stack: string; accent: string; theme: PdfTheme; coverage: CoverageTerms; ammoNumbers: string[]; },
): KitValidation {
  const layout = validateResumeHtml(html, {
    stack: input.stack,
    accentColor: input.accent,
    theme: input.theme,
  });
  const content = validateResumeContent(html, {
    mustCover: input.coverage.mustCover,
    forbidden: input.coverage.forbidden,
    coreKept: input.coverage.coreKept,
    ammoNumbers: input.ammoNumbers,
  });
  const hardViolations = [...layout.hardViolations, ...content.hardViolations];
  const warnings = [...layout.violations, ...content.violations].filter(
    (violation) => violation.optional,
  );
  return {
    attempts: 1,
    ok: hardViolations.length === 0,
    hardViolations,
    warnings,
  };
}

function toKit(
  data: Record<string, unknown>,
  job: KitJobData,
): KitData {
  return {
    company: text(data.company) || job.company,
    role: text(data.role) || job.title,
    fitRating: Number(data.fitRating ?? 0),
    fitAnalysis: text(data.fitAnalysis),
    resumeHtml: text(data.tailoredResumeHtml),
    coverLetterHtml: text(data.coverLetterHtml) || null,
    emailSubject: text(data.emailSubject),
    emailBody: text(data.emailBody),
    emailNotes: text(data.emailNotes),
    linkedInConnectionNote: text(data.linkedInConnectionNote),
    linkedInInMail: text(data.linkedInInMail),
  };
}

/**
 * Runs the generation: one LLM call, tolerant parse, validator retry (max 2
 * fix prompts) and a resumable `failed` when the kit stays invalid.
 */
export async function generateKit(
  input: GenerateKitInput,
  deps: KitGenerationDeps,
): Promise<GenerateKitResult> {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const stack = normalizeStack(input.stack);
  const language = normalizeLang(input.language);
  const needsInputRounds = Number(input.needsInputRounds ?? 0);
  const maxFixes = deps.fixAttempts ?? KIT_FIX_ATTEMPTS;

  const built = buildKitPrompt({
    job: input.job,
    baseRawText: deps.profile.rawText,
    stack,
    language,
    theme: deps.theme,
    fit: input.fit,
    fitConfirmed: input.fitConfirmed,
    userAnswer: input.userAnswer,
    approvedInferences: input.approvedInferences,
    rejectedInferences: input.rejectedInferences,
    coverLetterGuidance: input.coverLetterGuidance,
    artifactGuidance: input.artifactGuidance,
    cssContent: deps.cssContent ?? deps.loader.readTemplate('resume_style.css'),
    emailSection: deps.loader.buildEmailSection(language),
  });

  const system = withExtraPrompt(
    deps.loader.buildTailorSystemPrompt(),
    deps.profile.profile,
  );

  const parsed = parseKitOrQuestion(await deps.llm.call(built.prompt, system));

  if (parsed.type === 'needs_input') {
    if (needsInputRounds >= NEEDS_INPUT_MAX_ROUNDS) {
      return {
        status: 'failed',
        error: `Limite de clarificações da IA atingido (${NEEDS_INPUT_MAX_ROUNDS} rodadas). Gere o kit com os fatos disponíveis.`,
      };
    }
    if (parsed.kind === 'inference_approval') {
      try {
        assertInferencesGrounded(parsed.inferences, deps.profile.rawText);
      } catch (error) {
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      status: 'needs_input',
      question: {
        question: parsed.question,
        options: parsed.options,
        blockingField: parsed.blockingField,
        kind: parsed.kind,
        inferences: parsed.inferences,
        rawExcerpt: parsed.rawExcerpt,
      },
      needsInputRounds: needsInputRounds + 1,
      stack,
      language,
    };
  }

  const data = parsed.data;
  let validation = runChecks(text(data.tailoredResumeHtml), {
    stack,
    accent: built.accent,
    theme: deps.theme,
    coverage: built.coverage,
    ammoNumbers: built.ammoNumbers,
  });

  for (let attempt = 1; attempt <= maxFixes && !validation.ok; attempt++) {
    const hard = validation.hardViolations
      .map((violation) => `- [${violation.code}] ${violation.detail}`)
      .join('\n');
    warn(
      `[Kit] Validadores (layout+conteúdo): ${validation.hardViolations.length} violação(ões), retry ${attempt}/${maxFixes}`,
    );
    const fixPrompt = `Corrija o HTML abaixo segundo as violações, SEM inventar nenhum fato novo (só inclua termos que constam no currículo base; remova clichês e termos sem respaldo).
Violações a corrigir:
${hard}
Regras de layout: <div class="accent"></div> como primeiro filho de <body> (1 faixa, cor ${built.accent}); h2.section-title com border-top 2px solid ${built.accent} e sem border-bottom; Highlights como parágrafo com categorias strong (sem pills); nenhum <link>/<img>/fonte remota.
Regras de conteúdo: todo match da COBERTURA OBRIGATÓRIA deve aparecer com contexto real; todo termo VETADO deve sumir; todo número usado deve vir da munição/base.

HTML:
${text(data.tailoredResumeHtml).slice(0, 20000)}

SAÍDA: JSON válido {"tailoredResumeHtml": "<!DOCTYPE html>...corrigido..."} sem markdown.`;

    let fixed: Record<string, unknown>;
    try {
      fixed = JSON.parse(stripLlmFences(await deps.llm.call(fixPrompt, system))) as Record<
        string,
        unknown
      >;
    } catch (error) {
      warn(
        `[Kit] Retry de validação falhou no parse: ${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
    if (typeof fixed.tailoredResumeHtml === 'string' && fixed.tailoredResumeHtml) {
      data.tailoredResumeHtml = fixed.tailoredResumeHtml;
    }
    validation = {
      ...runChecks(text(data.tailoredResumeHtml), {
        stack,
        accent: built.accent,
        theme: deps.theme,
        coverage: built.coverage,
        ammoNumbers: built.ammoNumbers,
      }),
      attempts: attempt + 1,
    };
  }

  if (!validation.ok) {
    return {
      status: 'failed',
      error: `Kit inválido após ${maxFixes} correções: ${validation.hardViolations
        .map((violation) => violation.code)
        .join(', ')}`,
      validation,
    };
  }

  for (const violation of validation.warnings) {
    warn(`[Kit] AVISO conteúdo/layout [${violation.code}]: ${violation.detail}`);
  }

  return {
    status: 'done',
    kit: toKit(data, input.job),
    accent: built.accent,
    coverage: built.coverage,
    ammoNumbers: built.ammoNumbers,
    validation,
  };
}
