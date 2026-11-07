import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGES } from '../../domain/job.js';
import { EXTRA_PROMPT_MAX_LENGTH } from '../../domain/profile.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const STACK_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const settingBodySchema = z.object({ value: z.unknown() });

const extraPromptSchema = z
  .string()
  .max(EXTRA_PROMPT_MAX_LENGTH, 'Texto extra muito longo')
  .nullable()
  .optional();

const newProfileSchema = z.object({
  stack: z.string().trim().min(1),
  language: z.enum(LANGUAGES),
  content: z.unknown().optional(),
  enabled: z.boolean().optional(),
  extraPrompt: extraPromptSchema,
});

const profilePatchSchema = z
  .object({
    content: z.unknown().optional(),
    enabled: z.boolean().optional(),
    extraPrompt: extraPromptSchema,
  })
  .refine(
    (value) =>
      value.content !== undefined ||
      value.enabled !== undefined ||
      value.extraPrompt !== undefined,
    { message: 'Informe ao menos um campo: content, enabled ou extraPrompt' },
  );

function normalizeStack(raw: unknown): string {
  const stack = String(raw ?? '').trim().toLowerCase();
  if (!STACK_PATTERN.test(stack)) {
    throw new HttpError(
      400,
      'Stack inválida: use letras minúsculas, números e hífen, começando por letra',
    );
  }
  return stack;
}

function normalizeLanguage(raw: unknown): string {
  const language = String(raw ?? '').trim().toLowerCase();
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    throw new HttpError(
      400,
      `Idioma inválido: use ${LANGUAGES.join(' ou ')}`,
    );
  }
  return language;
}

/** Aceita `undefined` (não mexe), `null` e string; vazio/só espaços vira `null`. */
function normalizeExtraPrompt(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const CANDIDATE_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'linkedin',
  'github',
  'portfolio',
] as const;

type ThemeStack = { accent?: string; accentDark?: string };
type PdfTheme = {
  ruby?: ThemeStack;
  php?: ThemeStack;
  cssVersion?: string;
  [key: string]: unknown;
};

/**
 * Rotas de metadados: perfis base, tema de PDF, dados do formulário e settings.
 * Cobrem as leituras que a aba Admin do v1 faz.
 */
export function createMetaRouter(store: Store): Router {
  const router = Router();

  router.get('/base-resumes', (_req, res) => {
    const entries: Record<string, unknown> = {};
    const combos = [
      ['pt-br', 'ruby', 'pt-br'],
      ['en', 'ruby', 'en'],
      ['php-pt-br', 'php', 'pt-br'],
      ['php-en', 'php', 'en'],
    ] as const;

    for (const [key, stack, language] of combos) {
      const profile = store.profiles.get(stack, language);
      if (!profile) {
        entries[key] = { exists: false, language };
        continue;
      }

      const content =
        profile.content && typeof profile.content === 'object'
          ? (profile.content as Record<string, unknown>)
          : {};
      const rawText = typeof content.rawText === 'string' ? content.rawText : '';

      entries[key] = {
        exists: true,
        language,
        sourceFile: String(content.sourceFile ?? ''),
        updatedAt: content.extractedAt ?? profile.updatedAt,
        charCount: Number(content.rawLength ?? rawText.length ?? 0),
        preview: rawText ? `${rawText.slice(0, 500)}...` : '',
      };
    }

    res.json(entries);
  });

  router.get('/pdf-theme', (_req, res) => {
    res.json({
      success: true,
      theme: store.settings.get<PdfTheme>('pdf_theme') ?? {},
    });
  });

  router.put('/pdf-theme', (req, res) => {
    const current = store.settings.get<PdfTheme>('pdf_theme') ?? {};
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next: PdfTheme = {
      ruby: { ...(current.ruby ?? {}) },
      php: { ...(current.php ?? {}) },
      cssVersion: String(body.cssVersion ?? current.cssVersion ?? 'b1').slice(
        0,
        20,
      ),
    };

    for (const stack of ['ruby', 'php'] as const) {
      const patch =
        body[stack] && typeof body[stack] === 'object'
          ? (body[stack] as Record<string, unknown>)
          : {};

      for (const field of ['accent', 'accentDark'] as const) {
        if (patch[field] === undefined) continue;
        const value = String(patch[field]);
        if (!HEX_COLOR.test(value)) {
          throw new HttpError(
            400,
            `Cor inválida para ${stack}.${field} (use #RRGGBB)`,
          );
        }
        (next[stack] as ThemeStack)[field] = value.toUpperCase();
      }
    }

    store.settings.set('pdf_theme', next);
    res.json({ success: true, theme: next });
  });

  router.get('/candidate-data', (_req, res) => {
    res.json({
      success: true,
      candidate: store.settings.get('candidate_form') ?? {},
    });
  });

  router.put('/candidate-data', (req, res) => {
    const current =
      store.settings.get<Record<string, unknown>>('candidate_form') ?? {};
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };

    for (const field of CANDIDATE_FIELDS) {
      if (body[field] !== undefined) {
        next[field] = String(body[field] ?? '').slice(0, 300);
      }
    }

    if (next.fullName && !next.firstName) {
      const parts = String(next.fullName).split(' ');
      next.firstName = parts[0] ?? '';
      next.lastName = parts.slice(1).join(' ');
    }

    next.updatedAt = new Date().toISOString();
    store.settings.set('candidate_form', next);
    res.json({ success: true, candidate: next });
  });

  router.get('/profiles', (req, res) => {
    const rawEnabled = req.query.enabled;
    let enabled: boolean | undefined;

    if (rawEnabled !== undefined) {
      if (rawEnabled !== 'true' && rawEnabled !== 'false') {
        throw new HttpError(
          400,
          'Parâmetro enabled inválido (use true ou false)',
        );
      }
      enabled = rawEnabled === 'true';
    }

    const profiles = store.profiles
      .list()
      .filter((profile) => enabled === undefined || profile.enabled === enabled)
      .sort(
        (a, b) =>
          a.stack.localeCompare(b.stack) ||
          a.language.localeCompare(b.language),
      );

    res.json(profiles);
  });

  router.get('/profiles/:stack/:language', (req, res) => {
    const profile = store.profiles.get(
      req.params.stack,
      req.params.language,
    );
    if (!profile) throw new HttpError(404, 'Perfil não encontrado');
    res.json(profile);
  });

  router.post('/profiles', (req, res) => {
    const body = parseBody(newProfileSchema, req.body);
    const stack = normalizeStack(body.stack);
    const language = normalizeLanguage(body.language);

    if (store.profiles.get(stack, language)) {
      throw new HttpError(409, 'Essa combinação já existe');
    }

    const profile = store.profiles.upsert({
      stack,
      language,
      content: body.content,
      enabled: body.enabled,
      extraPrompt: normalizeExtraPrompt(body.extraPrompt),
    });

    res.status(201).json(profile);
  });

  router.put('/profiles/:stack/:language', (req, res) => {
    const stack = normalizeStack(req.params.stack);
    const language = normalizeLanguage(req.params.language);
    const patch = parseBody(profilePatchSchema, req.body);

    res.json(
      store.profiles.upsert({
        stack,
        language,
        content: patch.content,
        enabled: patch.enabled,
        extraPrompt: normalizeExtraPrompt(patch.extraPrompt),
      }),
    );
  });

  router.delete('/profiles/:stack/:language', (req, res) => {
    const stack = normalizeStack(req.params.stack);
    const language = normalizeLanguage(req.params.language);

    if (!store.profiles.delete(stack, language)) {
      throw new HttpError(404, 'Perfil não encontrado');
    }

    res.status(204).end();
  });

  router.get('/settings', (_req, res) => {
    res.json(store.settings.list());
  });

  router.get('/settings/:key', (req, res) => {
    const value = store.settings.get(req.params.key);
    if (value === null) throw new HttpError(404, 'Setting não encontrado');
    res.json({ key: req.params.key, value });
  });

  router.put('/settings/:key', (req, res) => {
    const input = parseBody(settingBodySchema, req.body);
    res.json(store.settings.set(req.params.key, input.value));
  });

  return router;
}
