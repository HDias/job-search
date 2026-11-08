import { Router } from 'express';
import { z } from 'zod';
import type { JobSnapshot } from '../../domain/run.js';
import { newId } from '../../domain/ids.js';
import { detectLangFromText } from '../../pipeline/content.js';
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

  return router;
}
