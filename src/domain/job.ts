import { z } from 'zod';

export const LANGUAGES = ['pt-br', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const JOB_STATUSES = [
  'drafted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'archived',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const fitDimensionsSchema = z.object({
  skillsMatch: z.number().optional(),
  experienceMatch: z.number().optional(),
  logisticsMatch: z.number().optional(),
  cultureMatch: z.number().optional(),
});
export type FitDimensions = z.infer<typeof fitDimensionsSchema>;

export const eligibilitySchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
});

export const languageGateSchema = z.object({
  required: z.string(),
  passed: z.boolean(),
  note: z.string().nullable().optional(),
});

export const fitSchema = z.object({
  rating: z.number().nullable().optional(),
  analysis: z.string().nullable().optional(),
  dimensions: fitDimensionsSchema.optional(),
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  eligibility: eligibilitySchema.nullable().optional(),
  languageGate: languageGateSchema.nullable().optional(),
  logisticsNote: z.string().nullable().optional(),
});
export type Fit = z.infer<typeof fitSchema>;

/**
 * Formato "document-shaped": os dados aninhados da análise ficam em um único
 * objeto JSON. Isso evita normalização excessiva e facilita a futura troca por
 * Firestore (onde o job vira um documento).
 */
export interface Job {
  id: string;
  ownerId: string;
  company: string;
  role: string;
  vacancyUrl: string | null;
  applyUrl: string | null;
  language: Language;
  stack: string;
  channel: string | null;
  status: JobStatus;
  appliedAt: string | null;
  fit: Fit | null;
  appliedEmails: string[];
  coverLetterGuidance: string | null;
  coverInCvRequired: boolean | null;
  coverInCvReason: string | null;
  hasRecruiterMessage: boolean;
  hasQuestions: boolean;
  skillGrounded: boolean | null;
  fitConfirmed: boolean | null;
  createdAt: string;
  updatedAt: string;
}

const nullableUrl = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

const newJobBaseSchema = z.object({
  id: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  company: z.string().trim().min(1),
  role: z.string().trim().min(1),
  vacancyUrl: nullableUrl.optional(),
  applyUrl: nullableUrl.optional(),
  language: z.enum(LANGUAGES).default('pt-br'),
  stack: z.string().trim().min(1).default('ruby'),
  channel: z.string().trim().min(1).nullable().optional(),
  status: z.enum(JOB_STATUSES).default('drafted'),
  appliedAt: z.string().datetime().nullable().optional(),
  fit: fitSchema.nullable().optional(),
  appliedEmails: z.array(z.string()).default([]),
  coverLetterGuidance: z.string().nullable().optional(),
  coverInCvRequired: z.boolean().nullable().optional(),
  coverInCvReason: z.string().nullable().optional(),
  hasRecruiterMessage: z.boolean().default(false),
  hasQuestions: z.boolean().default(false),
  skillGrounded: z.boolean().nullable().optional(),
  fitConfirmed: z.boolean().nullable().optional(),
});
export const newJobSchema = newJobBaseSchema;
export type NewJob = z.input<typeof newJobBaseSchema> & {
  /** Preservados na importação do v1. */
  createdAt?: string;
  updatedAt?: string;
};

export const jobPatchSchema = newJobBaseSchema.partial();
export type JobPatch = z.input<typeof jobPatchSchema>;

export interface JobFilter {
  ownerId?: string;
  status?: JobStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface JobList {
  items: Job[];
  total: number;
}

export interface JobStats {
  total: number;
  byStatus: Record<string, number>;
  averageFitRating: number | null;
  appliedLast30Days: number;
}
