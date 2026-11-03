import { Router } from 'express';
import type { Store } from '../../repositories/types.js';
import { HttpError } from '../http.js';
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
export function createCompatRouter(store: Store): Router {
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

  router.put('/processes/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.runs.update(
      req.params.id,
      legacyProcessPatch(body),
    );
    if (!updated) throw new HttpError(404, 'Checkpoint não encontrado');

    res.json({ success: true, process: toLegacyProcess(updated) });
  });

  router.delete('/processes/:id', (req, res) => {
    if (!store.runs.delete(req.params.id)) {
      throw new HttpError(404, 'Checkpoint não encontrado');
    }
    res.json({ success: true });
  });

  return router;
}
