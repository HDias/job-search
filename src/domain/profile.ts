export const EXTRA_PROMPT_MAX_LENGTH = 8000;

/** Document-shaped profile content (v1 `perfil_base_*.json` shape). */
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
  content: unknown;
  enabled: boolean;
  extraPrompt: string | null;
  updatedAt: string;
}

/** Campos `undefined` não sobrescrevem o valor atual (semântica de PATCH). */
export interface UpsertProfileInput {
  stack: string;
  language: string;
  content?: unknown;
  enabled?: boolean;
  extraPrompt?: string | null;
  updatedAt?: string;
}

export interface SettingsEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}
