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
  applyNote: string | null;
  applyMethod: string;
  chatHistory: ChatMessage[];
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

/** One turn of the post-response conversation (`jobs.chat_history`). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
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
  contentThin?: boolean;
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
  llmQuestion: LlmQuestion | null;
  needsInputRounds: number;
  clarificationHistory: ClarificationEntry[];
  coverLetterGuidance: string | null;
  includeCoverInCv: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LlmInference {
  skill: string;
  inferredFrom: string;
  confidence: 'high';
}

export interface LlmQuestion {
  question: string;
  options: string[];
  blockingField: string;
  kind: 'missing_fact' | 'inference_approval';
  inferences: LlmInference[];
  rawExcerpt: string;
}

export interface ClarificationEntry {
  answer: string;
  approvedInferences: string[];
  rejectedInferences: string[];
  at: string;
}

/** Body accepted by `POST /api/runs/:id/respond` (D6). */
export interface RespondInput {
  answer?: string;
  approvedInferences?: string[];
  rejectedInferences?: string[];
  coverLetterGuidance?: string;
  includeCoverInCv?: string | boolean;
}

export interface RespondResponse {
  runId: string;
}

/** `POST /api/profiles/:stack/:language/upload` (v1 response shape). */
export interface ResumeUploadResponse {
  success: boolean;
  message: string;
  fileName: string;
  charCount: number;
}

/** Body of `POST /api/fit-check` (202). */
export interface FitCheckInput {
  url?: string;
  rawText?: string;
  extraQuestions?: string;
  recruiterMessage?: string;
  languagePreference?: 'auto' | 'pt-br' | 'en';
  stack?: string;
  processId?: string;
  jobSnapshot?: JobSnapshot;
}

/** Body of `POST /api/generate-kit` (202). */
export interface GenerateKitInput {
  processId?: string;
  url?: string;
  rawText?: string;
  extraQuestions?: string;
  recruiterMessage?: string;
  language?: 'auto' | 'pt-br' | 'en';
  languagePreference?: 'auto' | 'pt-br' | 'en';
  stack?: string;
  jobSnapshot?: JobSnapshot;
  fitConfirmed?: boolean;
  userAnswer?: string;
  approvedInferences?: string[];
  rejectedInferences?: string[];
  coverLetterGuidance?: string;
  includeCoverInCv?: string | boolean;
  /** Artifact kinds to write; omitted means every kind. */
  artifacts?: string[];
}

export interface EnqueuedRun {
  runId: string;
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

export type AtsPlatform = 'greenhouse' | 'lever' | 'workable' | 'generic';

export type QuestionCategory =
  | 'upload'
  | 'personal'
  | 'legal'
  | 'demographic'
  | 'custom';

export interface ApplicationQuestion {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  name: string;
  category: QuestionCategory;
}

export interface StandardField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  name: string;
}

export interface QuestionsResponse {
  success: boolean;
  platform: AtsPlatform;
  questions: ApplicationQuestion[];
  standardFields: StandardField[];
  questionsUrl: string;
}

/** Body of `POST /api/jobs/:id/apply-confirm` (D1). */
export interface ApplyConfirmInput {
  approved: true;
  note?: string;
  channel?: string;
  appliedEmails?: string[];
}

export interface ApplyConfirmResponse {
  success: boolean;
  job: Job;
}

/** Body of `POST /api/jobs/:id/chat` (D3). */
export interface ChatInput {
  message: string;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  chat: ChatMessage[];
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

export const LLM_PROVIDERS = [
  'gemini',
  'openai',
  'openai-compatible',
  'nvidia',
  'anthropic',
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** `GET /api/llm-config`: the key is only ever exposed as `maskedKey` (D4). */
export interface LlmConfigView {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  temperature: number | '';
  top_p: number | '';
  maxTokens: number | '';
  hasKey: boolean;
  maskedKey: string;
}

/** Partial update; an omitted field is preserved (an empty `apiKey` too). */
export interface LlmConfigPatch {
  provider?: LlmProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
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
