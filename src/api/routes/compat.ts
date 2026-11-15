import { Router, type Request, type Response } from 'express';
import { applyConfirmInputSchema } from '../../domain/job.js';
import { confirmApplication, NOT_APPROVED_MESSAGE } from '../../pipeline/apply/confirm.js';
import { respondInputSchema, planResponse } from '../../pipeline/runs/respond.js';
import type { PipelineService } from '../../pipeline/service.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';
import {
  legacyApplicationPatch,
  legacyProcessPatch,
  toLegacyApplication,
  toLegacyProcess,
} from '../dto/legacy.js';

/**
 * Rotas no formato do v1. O `public/index.html` atual continua funcionando
 * contra elas enquanto as telas são migradas para React.
 */
export function createCompatRouter(
  store: Store,
  pipeline: PipelineService,
): Router {
  const router = Router();

  /* ---------------------------- applications ---------------------------- */

  router.get('/applications', (_req, res) => {
    const { items } = store.jobs.list({ limit: 200 });
    res.json(
      items.map((job) =>
        toLegacyApplication(job, store.artifacts.listByJob(job.id)),
      ),
    );
  });

  router.put('/applications/:id', (req, res) => {
    const current = store.jobs.get(req.params.id);
    if (!current) throw new HttpError(404, 'Candidatura não encontrada');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.jobs.update(
      req.params.id,
      legacyApplicationPatch(current, body),
    );
    if (!updated) throw new HttpError(404, 'Candidatura não encontrada');

    res.json({
      success: true,
      application: toLegacyApplication(
        updated,
        store.artifacts.listByJob(updated.id),
      ),
    });
  });

  router.post('/applications/:id/apply-confirm', (req, res) => {
    const input = parseBody(applyConfirmInputSchema, req.body ?? {});
    const outcome = confirmApplication(store, req.params.id, input);

    if (outcome.status === 'not_found') {
      throw new HttpError(404, 'Candidatura não encontrada');
    }
    if (outcome.status === 'not_approved') {
      throw new HttpError(400, NOT_APPROVED_MESSAGE);
    }

    res.json({
      success: true,
      application: toLegacyApplication(
        outcome.job,
        store.artifacts.listByJob(outcome.job.id),
      ),
    });
  });

  router.delete('/applications/:id', (req, res) => {
    if (!store.jobs.delete(req.params.id)) {
      throw new HttpError(404, 'Candidatura não encontrada');
    }
    res.json({ success: true, message: 'Candidatura removida com sucesso' });
  });

  /* ------------------------------ processes ----------------------------- */

  router.get('/processes', (_req, res) => {
    // O v1 só mostrava checkpoints pendentes no painel.
    res.json(
      store.runs
        .list({ limit: 500 })
        .filter((run) => run.stage !== 'done')
        .map(toLegacyProcess),
    );
  });

  router.put('/processes/:id', patchProcess);
  router.patch('/processes/:id', patchProcess);

  router.get('/processes/:id/question', (req, res) => {
    const run = store.runs.get(req.params.id);
    if (!run) throw new HttpError(404, 'Checkpoint não encontrado');
    if (run.stage !== 'needs_input' || !run.llmQuestion) {
      throw new HttpError(404, 'Nenhuma pergunta pendente neste processo.');
    }
    res.json({
      processId: run.id,
      question: run.llmQuestion,
      needsInputRounds: run.needsInputRounds || 1,
    });
  });

  router.post('/processes/:id/respond', (req, res) => {
    const parsed = respondInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, 'Dados inválidos', parsed.error.issues);
    }
    const plan = planResponse(store, req.params.id, parsed.data);

    if (plan.status === 'not_found') {
      throw new HttpError(404, 'Checkpoint não encontrado');
    }
    if (plan.status === 'not_waiting') {
      throw new HttpError(409, 'Este processo não está aguardando resposta.');
    }
    if (plan.status === 'empty_answer' || plan.status === 'unknown_inference') {
      throw new HttpError(400, plan.error);
    }

    store.runs.update(plan.run.id, {
      stage: 'generating',
      clarificationHistory: plan.history,
      coverLetterGuidance: plan.coverLetterGuidance,
      error: null,
    });
    pipeline.enqueueGenerateKit(plan.run.id, plan.payload);

    // v1 shape: `success: true` plus the process id; v2 is async, so the kit
    // arrives through `stage: done` when the queue finishes.
    res.status(202).json({
      success: true,
      processId: plan.run.id,
      runId: plan.run.id,
      status: 'generating',
    });
  });

  router.delete('/processes/:id', (req, res) => {
    if (!store.runs.delete(req.params.id)) {
      throw new HttpError(404, 'Checkpoint não encontrado');
    }
    res.json({ success: true });
  });

  function patchProcess(req: Request, res: Response): void {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.runs.update(
      String(req.params.id),
      legacyProcessPatch(body),
    );
    if (!updated) throw new HttpError(404, 'Checkpoint não encontrado');

    res.json({ success: true, process: toLegacyProcess(updated) });
  }

  return router;
}
