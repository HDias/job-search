import { z } from 'zod';
import type { Fit } from './job.js';

/**
 * Estágios do pipeline (v1 + modelo assíncrono do v2):
 * `queued` → `scraping` → `scrape-thin` | `fit-checked` → `generating` ⇄
 * `needs_input` → `done` | `failed`.
 */
export const RUN_STAGES = [
  'queued',
  'scraping',
  'scrape-thin',
  'fit-checked',
  'generating',
  'needs_input',
  'done',
  'failed',
] as const;
export type RunStage = (typeof RUN_STAGES)[number] | (string & {});

export const NEEDS_INPUT_MAX_ROUNDS = 2;
export const NEEDS_INPUT_ANSWER_LIMIT = 2000;

export type NeedsInputKind = 'missing_fact' | 'inference_approval';

export interface LlmInference {
  skill: string;
  inferredFrom: string;
  confidence: 'high';
}

/** Pergunta do checkpoint (`runs.llm_question`), envelope da skill. */
export interface LlmQuestion {
  question: string;
  options: string[];
  blockingField: string;
  kind: NeedsInputKind;
  inferences: LlmInference[];
  rawExcerpt: string;
}

/** Uma resposta registrada em `runs.clarification_history` (últimas 2). */
export interface ClarificationEntry {
  answer: string;
  approvedInferences: string[];
  rejectedInferences: string[];
  at: string;
}

export interface JobSnapshot {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  applyUrl?: string;
  detectedLanguage?: string;
  /** Texto raspado da vaga (pode ser grande). */
  content?: string;
  extraQuestions?: string;
  recruiterMessage?: string;
  /** Set when the scrape returned a shell instead of the description. */
  contentThin?: boolean;
}

export interface Run {
  id: string;
  jobId: string | null;
  stage: RunStage;
  url: string | null;
  stack: string | null;
  languagePreference: string | null;
  detectedLanguage: string | null;
  suggestedLanguage: string | null;
  needsLanguageConfirmation: boolean;
  needsFitConfirmation: boolean;
  eligibilityBlocked: boolean;
  hasRawText: boolean;
  hasExtraQuestions: boolean;
  hasRecruiterMessage: boolean;
  error: string | null;
  fit: Fit | null;
  /** Metadados da vaga (v1: `job`). */
  job: JobSnapshot | null;
  /** Snapshot completo, com `content` (v1: `jobSnapshot`). */
  jobSnapshot: JobSnapshot | null;
  /** Pergunta pendente da fila interativa (`needs_input`). */
  llmQuestion: LlmQuestion | null;
  /** Rodadas de `needs_input` já consumidas (máx. 2). */
  needsInputRounds: number;
  /** Últimas 2 respostas fornecidas pelo usuário. */
  clarificationHistory: ClarificationEntry[];
  coverLetterGuidance: string | null;
  /** `auto` | `true` | `false` | `never` | `force` */
  includeCoverInCv: string | null;
  createdAt: string;
  updatedAt: string;
}

export const llmInferenceSchema = z.object({
  skill: z.string().min(1),
  inferredFrom: z.string().min(1),
  confidence: z.literal('high'),
});

export const llmQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).default([]),
  blockingField: z.string().default(''),
  kind: z.enum(['missing_fact', 'inference_approval']),
  inferences: z.array(llmInferenceSchema).default([]),
  rawExcerpt: z.string().default(''),
});

export const clarificationEntrySchema = z.object({
  answer: z.string(),
  approvedInferences: z.array(z.string()).default([]),
  rejectedInferences: z.array(z.string()).default([]),
  at: z.string(),
});

const newRunBaseSchema = z.object({
  id: z.string().min(1).optional(),
  jobId: z.string().min(1).nullable().optional(),
  stage: z.string().min(1).default('queued'),
  url: z.string().nullable().optional(),
  stack: z.string().nullable().optional(),
  languagePreference: z.string().nullable().optional(),
  detectedLanguage: z.string().nullable().optional(),
  suggestedLanguage: z.string().nullable().optional(),
  needsLanguageConfirmation: z.boolean().default(false),
  needsFitConfirmation: z.boolean().default(false),
  eligibilityBlocked: z.boolean().default(false),
  hasRawText: z.boolean().default(false),
  hasExtraQuestions: z.boolean().default(false),
  hasRecruiterMessage: z.boolean().default(false),
  error: z.string().nullable().optional(),
  fit: z.unknown().nullable().optional(),
  job: z.unknown().nullable().optional(),
  jobSnapshot: z.unknown().nullable().optional(),
  llmQuestion: llmQuestionSchema.nullable().optional(),
  needsInputRounds: z.number().int().min(0).max(NEEDS_INPUT_MAX_ROUNDS).optional(),
  clarificationHistory: z.array(clarificationEntrySchema).optional(),
  coverLetterGuidance: z.string().nullable().optional(),
  includeCoverInCv: z.string().nullable().optional(),
});
export const newRunSchema = newRunBaseSchema;
export type NewRun = z.input<typeof newRunBaseSchema> & {
  createdAt?: string;
  updatedAt?: string;
};

export const runPatchSchema = newRunBaseSchema.partial();
export type RunPatch = z.input<typeof runPatchSchema>;

export interface RunFilter {
  jobId?: string;
  stage?: string;
  limit?: number;
  offset?: number;
}
