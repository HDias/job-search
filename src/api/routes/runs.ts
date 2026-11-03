import { Router } from 'express';
import { newRunSchema, runPatchSchema } from '../../domain/run.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';

function queryInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function createRunsRouter(store: Store): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(
      store.runs.list({
        jobId: typeof req.query.jobId === 'string' ? req.query.jobId : undefined,
        stage: typeof req.query.stage === 'string' ? req.query.stage : undefined,
        limit: queryInt(req.query.limit, 100),
        offset: queryInt(req.query.offset, 0),
      }),
    );
  });

  router.get('/:id', (req, res) => {
    const run = store.runs.get(req.params.id);
    if (!run) throw new HttpError(404, 'Processo não encontrado');
    res.json(run);
  });

  router.post('/', (req, res) => {
    const input = parseBody(newRunSchema, req.body);
    res.status(201).json(store.runs.create(input));
  });

  router.patch('/:id', (req, res) => {
    const patch = parseBody(runPatchSchema, req.body);
    const run = store.runs.update(req.params.id, patch);
    if (!run) throw new HttpError(404, 'Processo não encontrado');
    res.json(run);
  });

  router.delete('/:id', (req, res) => {
    if (!store.runs.delete(req.params.id)) {
      throw new HttpError(404, 'Processo não encontrado');
    }
    res.status(204).send();
  });

  return router;
}
