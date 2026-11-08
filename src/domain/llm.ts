import { z } from 'zod';

export const LLM_PROVIDERS = [
  'gemini',
  'openai',
  'openai-compatible',
  'nvidia',
  'anthropic',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  'openai-compatible': 'gpt-4o-mini',
  nvidia: 'openai/gpt-oss-20b',
  anthropic: 'claude-3-5-sonnet-20241022',
};

/**
 * LLM configuration persisted in `settings['llm_config']`. The `apiKey` lives
 * in the local database and is **never** returned by the API (only `hasKey`
 * and `maskedKey`).
 */
export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number | null;
  top_p: number | null;
  maxTokens: number | null;
}

/**
 * Config PATCH. `undefined` preserves the current value; `null` clears it.
 * `apiKey: ''` preserves it (parity with v1's `POST /api/llm-config`, which
 * resends an empty mask when the user did not change the key).
 */
export const llmConfigPatchSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS).optional(),
    apiKey: z.string().max(400).optional(),
    model: z.string().trim().max(120).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    top_p: z.number().min(0).max(1).nullable().optional(),
    maxTokens: z.number().int().min(1).max(32000).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: 'Informe ao menos um campo da configuração' },
  );
export type LlmConfigPatch = z.input<typeof llmConfigPatchSchema>;

/** Response of `GET /api/llm-config` — same shape as v1. */
export interface PublicLlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  temperature: number | '';
  top_p: number | '';
  maxTokens: number | '';
  hasKey: boolean;
  maskedKey: string;
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export function toPublicLlmConfig(config: LlmConfig): PublicLlmConfig {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    temperature: config.temperature ?? '',
    top_p: config.top_p ?? '',
    maxTokens: config.maxTokens ?? '',
    hasKey: Boolean(config.apiKey),
    maskedKey: maskApiKey(config.apiKey),
  };
}
