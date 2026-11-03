import { z } from 'zod';
import type { Fit } from './job.js';

export const RUN_STAGES = [
  'draft',
  'fit-checked',
  'processing',
  'awaiting-language',
  'awaiting-fit',
  'done',
  'error',
] as const;
export type RunStage = (typeof RUN_STAGES)[number] | (string & {});

export interface JobSnapshot {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  applyUrl?: string;
  detectedLanguage?: string;
}

export interface Run {
  id: string;
  jobId: string | null;
  stage: RunStage;
  url: string | null;
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
  jobSnapshot: JobSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

const newRunBaseSchema = z.object({
  id: z.string().min(1).optional(),
  jobId: z.string().min(1).nullable().optional(),
  stage: z.string().min(1).default('draft'),
  url: z.string().nullable().optional(),
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
  jobSnapshot: z.unknown().nullable().optional(),
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
