export const JOB_STATUSES = [
  'drafted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'archived',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface FitDimensions {
  skillsMatch?: number;
  experienceMatch?: number;
  logisticsMatch?: number;
  cultureMatch?: number;
}

export interface Eligibility {
  passed: boolean;
  reason: string;
}

export interface LanguageGate {
  required: string;
  passed: boolean;
  note?: string | null;
}

export interface Fit {
  rating?: number | null;
  analysis?: string | null;
  dimensions?: FitDimensions;
  strengths: string[];
  gaps: string[];
  eligibility?: Eligibility | null;
  languageGate?: LanguageGate | null;
  logisticsNote?: string | null;
}

export interface Job {
  id: string;
  ownerId: string;
  company: string;
  role: string;
  vacancyUrl: string | null;
  applyUrl: string | null;
  language: 'pt-br' | 'en';
  stack: string;
  channel: string | null;
  languageConfirmation: string | null;
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

export interface JobSnapshot {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  applyUrl?: string;
  detectedLanguage?: string;
  content?: string;
  extraQuestions?: string;
  recruiterMessage?: string;
}

export interface Run {
  id: string;
  jobId: string | null;
  stage: string;
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
  job: JobSnapshot | null;
  jobSnapshot: JobSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  jobId: string;
  runId: string | null;
  kind: string;
  relativePath: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface JobStats {
  total: number;
  byStatus: Record<string, number>;
  averageFitRating: number | null;
  appliedLast30Days: number;
}

export interface JobList {
  items: Job[];
  total: number;
}

export interface JobDetailResponse {
  job: Job;
  runs: Run[];
  artifacts: Artifact[];
}

export interface JobFilters {
  status?: JobStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface BaseResumeInfo {
  exists: boolean;
  language: string;
  sourceFile?: string;
  updatedAt?: string;
  charCount?: number;
  preview?: string;
}

export type BaseResumeKey = 'pt-br' | 'en' | 'php-pt-br' | 'php-en';

export type BaseResumeMap = Record<BaseResumeKey, BaseResumeInfo>;

export interface ProfileContent {
  rawText?: string;
  rawLength?: number;
  sourceFile?: string;
  extractedAt?: string;
  language?: string;
  stack?: string;
  [key: string]: unknown;
}

export interface Profile {
  stack: string;
  language: string;
  content: ProfileContent | null;
  enabled: boolean;
  extraPrompt: string | null;
  updatedAt: string;
}

export interface ProfilePatch {
  content?: ProfileContent;
  enabled?: boolean;
  extraPrompt?: string | null;
}

export interface NewProfile {
  stack: string;
  language: 'pt-br' | 'en';
  content?: ProfileContent;
  enabled?: boolean;
  extraPrompt?: string | null;
}

export const EXTRA_PROMPT_MAX_LENGTH = 8000;

export interface PdfThemeStack {
  accent?: string;
  accentDark?: string;
  label?: string;
  [key: string]: unknown;
}

export interface PdfTheme {
  ruby?: PdfThemeStack;
  php?: PdfThemeStack;
  cssVersion?: string;
  [key: string]: unknown;
}

export interface CandidateData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
