import { DEFAULT_MODEL_BY_PROVIDER, type LlmConfig } from '../../domain/llm.js';
import { loadLlmConfig } from './config.js';
import type { SettingsRepository } from '../../repositories/types.js';

/**
 * Faithful port of v1's `llm_client.mjs`: non-streaming calls over fetch with
 * retry/backoff on transient errors and dispatch per provider.
 */

export const LLM_RETRY_DELAYS_MS = [2000, 6000, 12000] as const;

export interface LlmResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<Record<string, unknown>>;
}

export type LlmFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<LlmResponseLike>;

export class LlmError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

export interface CallLlmOptions {
  maxRetries?: number;
}

export interface LlmClient {
  /** Reads the saved config on every call (Admin changes apply immediately). */
  call(
    prompt: string,
    systemInstruction?: string,
    options?: CallLlmOptions,
  ): Promise<string>;
}

export interface LlmClientDeps {
  /** Reads `settings['llm_config']` on every call. */
  settings?: SettingsRepository;
  /** Frozen config (runs and tests); takes precedence over `settings`. */
  config?: LlmConfig;
  fetchImpl?: LlmFetch;
  sleep?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
  env?: Record<string, string | undefined>;
}

const TRANSIENT_PATTERN =
  /high demand|overload|rate limit|try again|temporar|timeout|timed out|econnreset|socket hang up|fetch failed/i;

export function isRetryableError(status: number, message: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return TRANSIENT_PATTERN.test(message || '');
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Transient errors (429/5xx, overload) deserve automatic retry.
 * Passing `config` freezes the configuration; otherwise `settings` is read on
 * every call (switching provider in the Admin takes effect immediately).
 */
export function createLlmClient(deps: LlmClientDeps): LlmClient {
  const fetchImpl: LlmFetch = deps.fetchImpl ?? (fetch as unknown as LlmFetch);
  const sleep = deps.sleep ?? defaultSleep;
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  return {
    async call(prompt, systemInstruction = '', { maxRetries = 3 } = {}) {
      const config =
        deps.config ??
        (deps.settings
          ? loadLlmConfig(deps.settings, deps.env ?? process.env)
          : undefined);
      if (!config) {
        throw new LlmError('Configuração de LLM indisponível.');
      }
      const apiKey = config.apiKey?.trim();

      if (!apiKey) {
        throw new LlmError(
          'Chave de API não configurada. Configure sua API Key em Admin → LLM.',
        );
      }

      const provider = (config.provider || 'gemini').toLowerCase();

      for (let attempt = 1; ; attempt++) {
        try {
          return await dispatchLlmCall({
            fetchImpl,
            provider,
            config,
            apiKey,
            prompt,
            systemInstruction,
          });
        } catch (err) {
          const status = err instanceof LlmError ? err.status : 0;
          const message = err instanceof Error ? err.message : String(err);
          if (attempt > maxRetries || !isRetryableError(status, message)) {
            throw err;
          }
          const delay =
            LLM_RETRY_DELAYS_MS[attempt - 1] ??
            LLM_RETRY_DELAYS_MS[LLM_RETRY_DELAYS_MS.length - 1];
          warn(
            `[LLM] Tentativa ${attempt}/${maxRetries} falhou (${status || 'rede'}: ${message}). Retentando em ${delay / 1000}s...`,
          );
          await sleep(delay);
        }
      }
    },
  };
}

interface DispatchArgs {
  fetchImpl: LlmFetch;
  provider: string;
  config: LlmConfig;
  apiKey: string;
  prompt: string;
  systemInstruction: string;
}

async function dispatchLlmCall(args: DispatchArgs): Promise<string> {
  const { fetchImpl, provider, config, apiKey, prompt, systemInstruction } =
    args;

  // 1. Google Gemini
  if (provider === 'gemini') {
    const model = config.model || DEFAULT_MODEL_BY_PROVIDER.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new LlmError(
        errorMessage(data, `Erro da API Gemini: HTTP ${res.status}`),
        res.status,
      );
    }

    const candidates = data.candidates as
      | { content?: { parts?: { text?: string }[] } }[]
      | undefined;
    return candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // 2. OpenAI + compatibles (OpenAI, NVIDIA Build, etc.)
  if (
    provider === 'openai' ||
    provider === 'nvidia' ||
    provider === 'openai-compatible'
  ) {
    // Short aliases -> full ids on NVIDIA (e.g. deepseek-v4.1-flash -> deepseek-ai/...)
    const modelAliases: Record<string, string> = {
      'deepseek-v4.1-flash': 'deepseek-ai/deepseek-v4.1-flash',
      'deepseek-coder': 'deepseek-ai/deepseek-coder-6.7b-instruct',
    };
    const endpoints: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
    };
    let model =
      config.model ||
      DEFAULT_MODEL_BY_PROVIDER[
        provider as 'openai' | 'nvidia' | 'openai-compatible'
      ] ||
      DEFAULT_MODEL_BY_PROVIDER.openai;
    if (modelAliases[model]) model = modelAliases[model];
    const endpoint =
      config.baseUrl && config.baseUrl.trim()
        ? config.baseUrl.trim().replace(/\/$/, '')
        : endpoints[provider] || endpoints.openai;

    const messages: { role: string; content: string }[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    // Sampling: Admin override (config) or per-family defaults.
    // DeepSeek requires temperature=1 / top_p=0.95 (NVIDIA model card).
    const isDeepSeek = /deepseek/i.test(model);
    const temperature =
      config.temperature ?? (isDeepSeek ? 1 : 0.2);
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: config.maxTokens ?? (isDeepSeek ? 8192 : 4096),
    };
    if (config.top_p !== null && config.top_p !== undefined) {
      payload.top_p = config.top_p;
    } else if (isDeepSeek) {
      payload.top_p = 0.95;
    }

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new LlmError(
        openAiFamilyError(
          data,
          `Erro da API ${provider}: HTTP ${res.status}`,
        ),
        res.status,
      );
    }

    const choices = data.choices as
      | { message?: { content?: unknown } }[]
      | undefined;
    const content = choices?.[0]?.message?.content;
    // NVIDIA GPT-OSS may return content as a string or an array of chunks
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((chunk) =>
          typeof chunk === 'string' ? chunk : (chunk?.text as string) || '',
        )
        .join('');
    }
    return '';
  }

  // 3. Anthropic
  if (provider === 'anthropic') {
    const model = config.model || DEFAULT_MODEL_BY_PROVIDER.anthropic;
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemInstruction) body.system = systemInstruction;

    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new LlmError(
        errorMessage(data, `Erro da API Anthropic: HTTP ${res.status}`),
        res.status,
      );
    }

    const blocks = data.content as { text?: string }[] | undefined;
    return blocks?.[0]?.text || '';
  }

  throw new LlmError(`Provedor de IA desconhecido: ${provider}`);
}

function errorMessage(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const error = data.error as { message?: string } | undefined;
  return String(error?.message || fallback);
}

/** On v1, OpenAI/NVIDIA families report the error on `detail` before `error.message`. */
function openAiFamilyError(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const error = data.error as { message?: string } | undefined;
  return String(data.detail || error?.message || data.title || fallback);
}
