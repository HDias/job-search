import {
  DEFAULT_MODEL_BY_PROVIDER,
  LLM_PROVIDERS,
  type LlmConfig,
  type LlmConfigPatch,
  type LlmProvider,
} from '../../domain/llm.js';
import type { SettingsRepository } from '../../repositories/types.js';

export const LLM_CONFIG_KEY = 'llm_config';

type Env = Record<string, string | undefined>;

function isProvider(value: unknown): value is LlmProvider {
  return (
    typeof value === 'string' &&
    (LLM_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Reads the config from the `settings` table with v1 defaults and a key
 * fallback: when no `apiKey` is saved and the provider is `gemini`, uses
 * `GEMINI_API_KEY` from the environment.
 */
export function loadLlmConfig(
  settings: SettingsRepository,
  env: Env = process.env,
): LlmConfig {
  const stored =
    settings.get<Partial<LlmConfig> & { max_tokens?: number | null }>(
      LLM_CONFIG_KEY,
    ) ?? {};

  const provider = isProvider(stored.provider) ? stored.provider : 'gemini';
  const model = stored.model?.trim() || DEFAULT_MODEL_BY_PROVIDER[provider];

  const storedKey = typeof stored.apiKey === 'string' ? stored.apiKey.trim() : '';
  const envKey =
    provider === 'gemini' ? (env.GEMINI_API_KEY ?? '').trim() : '';

  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    provider,
    apiKey: storedKey || envKey,
    model,
    baseUrl:
      typeof stored.baseUrl === 'string' ? stored.baseUrl.trim() : '',
    temperature: num(stored.temperature),
    top_p: num(stored.top_p),
    maxTokens: num(stored.maxTokens ?? stored.max_tokens),
  };
}

/**
 * Merges a partial PATCH into the saved config (`PUT /api/llm-config`
 * semantics): `undefined` preserves, `null` clears, `apiKey: ''` keeps the
 * current key. Changing provider without sending `model` resets it to the new
 * provider's default.
 */
export function saveLlmConfig(
  settings: SettingsRepository,
  patch: LlmConfigPatch,
  env: Env = process.env,
): LlmConfig {
  const current = loadLlmConfig(settings, env);

  const provider = patch.provider ?? current.provider;
  const providerChanged = provider !== current.provider;

  let model = current.model;
  if (patch.model !== undefined) {
    model = patch.model.trim() || DEFAULT_MODEL_BY_PROVIDER[provider];
  } else if (providerChanged) {
    model = DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  let apiKey = current.apiKey;
  if (patch.apiKey !== undefined && patch.apiKey.trim() !== '') {
    apiKey = patch.apiKey.trim();
  }

  const next: LlmConfig = {
    provider,
    apiKey,
    model,
    baseUrl:
      patch.baseUrl !== undefined ? patch.baseUrl.trim() : current.baseUrl,
    temperature:
      patch.temperature === undefined
        ? current.temperature
        : patch.temperature,
    top_p: patch.top_p === undefined ? current.top_p : patch.top_p,
    maxTokens:
      patch.maxTokens === undefined ? current.maxTokens : patch.maxTokens,
  };

  settings.set(LLM_CONFIG_KEY, next);
  return next;
}
