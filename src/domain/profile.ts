export const EXTRA_PROMPT_MAX_LENGTH = 8000;

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
