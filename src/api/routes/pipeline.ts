import { Router } from 'express';
import { z } from 'zod';
import type { Fit } from '../../domain/job.js';
import type { JobSnapshot } from '../../domain/run.js';
import { newId } from '../../domain/ids.js';
import {
  detectLangFromText,
  hasExplicitLanguageRequirement,
  normalizeLang,
} from '../../pipeline/content.js';
import type { GenerateKitPayload } from '../../pipeline/queue.js';
import {
  planResponse,
  respondInputSchema,
} from '../../pipeline/runs/respond.js';
import { startRegeneration } from '../../pipeline/runs/regenerate.js';
import type { PipelineService } from '../../pipeline/service.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';

const evaluateFitSchema = z.object({
  jobText: z.string().trim().min(1, 'jobText é obrigatório'),
  jobLang: z.enum(['auto', 'pt', 'en']).optional(),
  applicationId: z.string().min(1).nullable().optional(),
  stack: z.string().min(1).nullable().optional(),
});

const jobSnapshotSchema = z
  .object({
    title: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    url: z.string().optional(),
    applyUrl: z.string().optional(),
    detectedLanguage: z.string().optional(),
    content: z.string().optional(),
    extraQuestions: z.string().optional(),
    recruiterMessage: z.string().optional(),
    contentThin: z.boolean().optional(),
  })
  .partial();

const fitCheckSchema = z
  .object({
    url: z.string().trim().optional(),
    rawText: z.string().optional(),
    extraQuestions: z.string().optional(),
    recruiterMessage: z.string().optional(),
    languagePreference: z.enum(['auto', 'pt-br', 'en']).optional(),
    stack: z.string().trim().min(1).optional(),
    processId: z.string().trim().min(1).optional(),
    jobSnapshot: jobSnapshotSchema.optional(),
  })
  .refine((body) => Boolean(body.url || body.rawText || body.jobSnapshot), {
    message: 'Forneça o link da vaga ou o texto descritivo.',
    path: ['url'],
  });

const generateKitSchema = z
  .object({
    processId: z.string().trim().min(1).optional(),
    url: z.string().trim().optional(),
    rawText: z.string().optional(),
    extraQuestions: z.string().optional(),
    recruiterMessage: z.string().optional(),
    language: z.enum(['auto', 'pt-br', 'en']).optional(),
    languagePreference: z.enum(['auto', 'pt-br', 'en']).optional(),
    stack: z.string().trim().min(1).optional(),
    jobSnapshot: jobSnapshotSchema.optional(),
    fitSnapshot: z.unknown().optional(),
    fitConfirmed: z.boolean().optional(),
    userAnswer: z.string().optional(),
    approvedInferences: z.array(z.string()).optional(),
    rejectedInferences: z.array(z.string()).optional(),
    needsInputRounds: z.number().int().min(0).max(2).optional(),
    coverLetterGuidance: z.string().optional(),
    includeCoverInCv: z.union([z.string(), z.boolean()]).optional(),
  })
  .refine(
    (body) =>
      Boolean(body.processId || body.url || body.rawText || body.jobSnapshot),
    {
      message: 'Forneça o processo, o link da vaga ou o texto descritivo.',
      path: ['processId'],
    },
  );

const prefillSchema = z.object({
  applyUrl: z.string().trim().optional(),
  candidateData: z.record(z.string(), z.unknown()).optional(),
  headed: z.boolean().optional(),
});

const questionsSchema = z.object({
  applyUrl: z.string().trim().optional(),
});

const chatSchema = z.object({
  message: z.string().trim().min(1, 'message é obrigatório'),
});

const regenerateSchema = z.object({
  languagePreference: z.enum(['auto', 'pt-br', 'en']).optional(),
  stack: z.string().trim().min(1).optional(),
  rawText: z.string().optional(),
  extraQuestions: z.string().optional(),
  recruiterMessage: z.string().optional(),
  coverLetterGuidance: z.string().optional(),
  includeCoverInCv: z.union([z.string(), z.boolean()]).optional(),
});

/**
 * Native (async) pipeline routes. Legacy `/api/processes` keeps working through
 * the compatibility DTO; these are the ones the React UI and integrations use.
 */
export function createPipelineRouter(
  store: Store,
  pipeline: PipelineService,
): Router {
  const router = Router();

  router.post('/evaluate-fit', (req, res) => {
    const body = parseBody(evaluateFitSchema, req.body);

    let outcome;
    try {
      outcome = pipeline.evaluateFit({
        jobText: body.jobText,
        jobLang: body.jobLang,
        applicationId: body.applicationId,
        stack: body.stack,
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    }

    res.json({
      success: true,
      ...outcome.result,
      applicationId: outcome.applicationId,
    });
  });

  router.post('/fit-check', (req, res) => {
    const body = parseBody(fitCheckSchema, req.body);
    const stack = body.stack?.toLowerCase() || 'ruby';
    const snapshot = body.jobSnapshot as JobSnapshot | undefined;

    // Pasted-only requests carry the text in the snapshot so the queue can run
    // without a second scrape; URL requests keep the snapshot empty.
    const jobSnapshot: JobSnapshot | null = snapshot
      ? snapshot
      : !body.url && body.rawText
        ? {
            url: '',
            title: 'Vaga Manual',
            company: 'Empresa',
            location: '',
            applyUrl: '',
            detectedLanguage: detectLangFromText(body.rawText),
            content: body.rawText,
            extraQuestions: body.extraQuestions || '',
            recruiterMessage: body.recruiterMessage || '',
          }
        : null;

    const existing = body.processId
      ? store.runs.get(body.processId)
      : null;

    const run = existing
      ? (store.runs.update(existing.id, {
          stage: 'queued',
          url: body.url || existing.url || '',
          stack,
          languagePreference: body.languagePreference || 'auto',
          hasRawText: Boolean(body.rawText),
          hasExtraQuestions: Boolean(body.extraQuestions),
          hasRecruiterMessage: Boolean(body.recruiterMessage),
          jobSnapshot,
          error: null,
          fit: null,
          needsLanguageConfirmation: false,
          needsFitConfirmation: false,
          eligibilityBlocked: false,
        }) as NonNullable<typeof existing>)
      : store.runs.create({
          id: body.processId || newId('proc'),
          stage: 'queued',
          url: body.url || '',
          stack,
          languagePreference: body.languagePreference || 'auto',
          hasRawText: Boolean(body.rawText),
          hasExtraQuestions: Boolean(body.extraQuestions),
          hasRecruiterMessage: Boolean(body.recruiterMessage),
          jobSnapshot,
          error: null,
          fit: null,
        });

    pipeline.enqueueFitCheck(run.id, {
      url: body.url,
      rawText: body.rawText,
      extraQuestions: body.extraQuestions,
      recruiterMessage: body.recruiterMessage,
      languagePreference: body.languagePreference,
      stack,
    });

    res.status(202).json({ runId: run.id });
  });

  router.post('/generate-kit', (req, res) => {
    const body = parseBody(generateKitSchema, req.body);
    const existing = body.processId
      ? store.runs.get(body.processId)
      : null;

    // D6 replay: a pending question with no new answer is returned untouched
    // and never reaches the LLM. The gates already passed when it was created.
    const isReplay = Boolean(
      existing?.stage === 'needs_input' &&
        existing.llmQuestion &&
        !body.userAnswer,
    );

    const explicitLanguage = (() => {
      if (body.language && body.language !== 'auto') return normalizeLang(body.language);
      if (body.languagePreference && body.languagePreference !== 'auto') {
        return normalizeLang(body.languagePreference);
      }
      if (existing?.languagePreference && existing.languagePreference !== 'auto') {
        return normalizeLang(existing.languagePreference);
      }
      return null;
    })();

    const snapshot =
      (body.jobSnapshot as JobSnapshot | undefined) ??
      existing?.jobSnapshot ??
      null;
    const fit =
      (body.fitSnapshot && typeof body.fitSnapshot === 'object'
        ? (body.fitSnapshot as Fit)
        : undefined) ??
      existing?.fit ??
      null;

    if (!isReplay) {
      // Gate 1 — the language must be explicit (no auto-detect at generation).
      if (!explicitLanguage) {
        res.status(409).json({
          error: 'Confirme o idioma do currículo antes de gerar o kit.',
          needsLanguageConfirmation: true,
          hint: 'Envie { language: "en" | "pt-br" } após confirmar no fit-check.',
        });
        return;
      }

      // Gate 2 — low fit or failed eligibility needs an explicit confirmation.
      if (fit) {
        const rating = Number(fit.rating ?? 0);
        const blocked = fit.eligibility?.passed === false;
        const jobConfirmed = existing?.jobId
          ? store.jobs.get(existing.jobId)?.fitConfirmed === true
          : false;
        const confirmed = body.fitConfirmed === true || jobConfirmed;
        if ((blocked || rating < 50) && !confirmed) {
          res.status(409).json({
            error: blocked
              ? `Elegibilidade reprovada: ${
                  fit.eligibility?.reason || 'verifique visto/cidadania'
                }. Confirme explicitamente para prosseguir.`
              : `Aderência baixa (${rating}%). Confirme explicitamente para prosseguir.`,
            needsFitConfirmation: true,
            eligibilityBlocked: blocked,
            fitRating: rating,
          });
          return;
        }

        // Gate 3 — a posting that explicitly names another language wins, a
        // mere detection divergence does not (v1 fix).
        const required =
          fit.languageGate?.required || snapshot?.detectedLanguage || '';
        if (
          required &&
          normalizeLang(required) !== explicitLanguage &&
          hasExplicitLanguageRequirement(snapshot?.content, required)
        ) {
          res.status(409).json({
            error: `A vaga exige currículo em ${
              normalizeLang(required) === 'en' ? 'Inglês' : 'Português (PT-BR)'
            } (detectado: "${required}"). Use language="${normalizeLang(
              required,
            )}".`,
            needsLanguageConfirmation: true,
            jobRequiredLanguage: normalizeLang(required),
            providedLanguage: explicitLanguage,
          });
          return;
        }
      }
    }

    const stack = body.stack?.toLowerCase() || existing?.stack || 'ruby';
    const jobSnapshot: JobSnapshot | null =
      snapshot ??
      (!body.url && body.rawText
        ? {
            url: '',
            title: 'Vaga Manual',
            company: 'Empresa',
            location: '',
            applyUrl: '',
            detectedLanguage: detectLangFromText(body.rawText),
            content: body.rawText,
            extraQuestions: body.extraQuestions || '',
            recruiterMessage: body.recruiterMessage || '',
          }
        : null);

    const languagePreference = explicitLanguage ?? 'auto';

    const run = existing
      ? store.runs.update(existing.id, {
          // Replay keeps `needs_input`; a real attempt starts from `queued`.
          ...(isReplay ? {} : { stage: 'queued' }),
          url: body.url || existing.url || '',
          stack,
          languagePreference,
          hasRawText: Boolean(body.rawText) || existing.hasRawText,
          hasExtraQuestions:
            Boolean(body.extraQuestions) || existing.hasExtraQuestions,
          hasRecruiterMessage:
            Boolean(body.recruiterMessage) || existing.hasRecruiterMessage,
          jobSnapshot: jobSnapshot ?? existing.jobSnapshot,
          fit: fit ?? existing.fit,
          error: isReplay ? existing.error : null,
          needsLanguageConfirmation: false,
          needsFitConfirmation: false,
          eligibilityBlocked: false,
        }) as NonNullable<typeof existing>
      : store.runs.create({
          id: body.processId || newId('proc'),
          stage: 'queued',
          url: body.url || '',
          stack,
          languagePreference,
          hasRawText: Boolean(body.rawText),
          hasExtraQuestions: Boolean(body.extraQuestions),
          hasRecruiterMessage: Boolean(body.recruiterMessage),
          jobSnapshot,
          fit,
          error: null,
        });

    const payload: GenerateKitPayload = {
      url: body.url,
      rawText: body.rawText,
      extraQuestions: body.extraQuestions,
      recruiterMessage: body.recruiterMessage,
      language: explicitLanguage,
      stack,
      fitConfirmed: body.fitConfirmed,
      userAnswer: body.userAnswer,
      approvedInferences: body.approvedInferences,
      rejectedInferences: body.rejectedInferences,
      needsInputRounds: body.needsInputRounds,
      coverLetterGuidance: body.coverLetterGuidance,
      includeCoverInCv: body.includeCoverInCv,
    };

    pipeline.enqueueGenerateKit(run.id, payload);
    res.status(202).json({ runId: run.id });
  });

  router.get('/runs/:id/question', (req, res) => {
    const run = store.runs.get(req.params.id);
    if (!run) throw new HttpError(404, 'Checkpoint não encontrado');
    if (run.stage !== 'needs_input' || !run.llmQuestion) {
      throw new HttpError(404, 'Nenhuma pergunta pendente neste processo.');
    }
    res.json({
      runId: run.id,
      processId: run.id,
      question: run.llmQuestion,
      needsInputRounds: run.needsInputRounds || 1,
    });
  });

  router.post('/runs/:id/respond', (req, res) => {
    const body = parseBody(respondInputSchema, req.body);
    const plan = planResponse(store, req.params.id, body);

    if (plan.status === 'not_found') {
      throw new HttpError(404, 'Checkpoint não encontrado');
    }
    if (plan.status === 'not_waiting') {
      throw new HttpError(409, 'Este processo não está aguardando resposta.');
    }
    if (plan.status === 'empty_answer') {
      throw new HttpError(400, plan.error);
    }
    if (plan.status === 'unknown_inference') {
      throw new HttpError(400, plan.error);
    }

    store.runs.update(plan.run.id, {
      stage: 'generating',
      clarificationHistory: plan.history,
      coverLetterGuidance: plan.coverLetterGuidance,
      error: null,
    });
    pipeline.enqueueGenerateKit(plan.run.id, plan.payload);
    res.status(202).json({ runId: plan.run.id });
  });

  router.post('/jobs/:id/prefill', async (req, res) => {
    const body = parseBody(prefillSchema, req.body ?? {});
    const outcome = await pipeline.prefill(req.params.id, body);

    if (outcome.status === 'not_found') {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    if (outcome.status === 'no_url') {
      throw new HttpError(
        400,
        'Informe a URL do formulário de candidatura (applyUrl).',
      );
    }
    if (outcome.status === 'no_pdf') {
      throw new HttpError(
        400,
        'PDF do currículo não encontrado para anexar.',
      );
    }

    res.json({ success: true, prefill: outcome.prefill });
  });

  router.post('/jobs/:id/questions', async (req, res) => {
    const body = parseBody(questionsSchema, req.body ?? {});
    const outcome = await pipeline.scrapeQuestions(req.params.id, body);

    if (outcome.status === 'not_found') {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    if (outcome.status === 'no_url') {
      throw new HttpError(
        400,
        'Informe a URL do formulário de candidatura (applyUrl).',
      );
    }
    if (outcome.status === 'no_folder') {
      throw new HttpError(
        400,
        'Gere o kit antes de extrair as perguntas da candidatura.',
      );
    }

    res.json({
      success: true,
      platform: outcome.result.platform,
      questions: outcome.result.questions,
      standardFields: outcome.result.standardFields,
      questionsUrl: outcome.questionsUrl,
    });
  });

  router.post('/jobs/:id/chat', async (req, res) => {
    const body = parseBody(chatSchema, req.body ?? {});
    const outcome = await pipeline.chat(req.params.id, body.message);

    if (outcome.status === 'not_found') {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    if (outcome.status === 'empty_message') {
      throw new HttpError(400, 'Envie uma mensagem não vazia.');
    }
    if (outcome.status === 'no_context') {
      throw new HttpError(
        409,
        'Rode o fit-check e gere o snapshot da vaga antes de conversar sobre ela.',
      );
    }

    res.json({ success: true, reply: outcome.reply, chat: outcome.chat });
  });

  router.post('/jobs/:id/regenerate', (req, res) => {
    const body = parseBody(regenerateSchema, req.body);
    const plan = startRegeneration(store, req.params.id, body);

    if (plan.status === 'not_found') {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    if (plan.status === 'no_source') {
      throw new HttpError(400, plan.error);
    }
    if (plan.status === 'language_conflict') {
      res.status(409).json({
        error: plan.error,
        needsLanguageConfirmation: true,
        jobRequiredLanguage: plan.jobRequiredLanguage,
        providedLanguage: plan.providedLanguage,
      });
      return;
    }

    pipeline.enqueueGenerateKit(plan.run.id, plan.payload);
    res.status(202).json({ runId: plan.run.id });
  });

  return router;
}
