import { Router } from 'express';
import { z } from 'zod';
import {
  JOB_STATUSES,
  jobPatchSchema,
  newJobSchema,
  type JobStatus,
} from '../../domain/job.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';

const statusSchema = z.enum(JOB_STATUSES);

function queryInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function createJobsRouter(store: Store): Router {
  const router = Router();

  router.get('/', (req, res) => {
    let status: JobStatus | undefined;
    if (typeof req.query.status === 'string' && req.query.status.length > 0) {
      const parsed = statusSchema.safeParse(req.query.status);
      if (!parsed.success) {
        throw new HttpError(400, `status inválido: ${req.query.status}`);
      }
      status = parsed.data;
    }

    res.json(
      store.jobs.list({
        status,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        ownerId:
          typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined,
        limit: queryInt(req.query.limit, 50),
        offset: queryInt(req.query.offset, 0),
      }),
    );
  });

  router.get('/:id', (req, res) => {
    const job = store.jobs.get(req.params.id);
    if (!job) throw new HttpError(404, 'Vaga não encontrada');

    res.json({
      job,
      runs: store.runs.list({ jobId: job.id }),
      artifacts: store.artifacts.listByJob(job.id),
    });
  });

  router.post('/', (req, res) => {
    const input = parseBody(newJobSchema, req.body);
    const job = store.jobs.create(input);
    res.status(201).json(job);
  });

  router.patch('/:id', (req, res) => {
    const patch = parseBody(jobPatchSchema, req.body);
    const job = store.jobs.update(req.params.id, patch);
    if (!job) throw new HttpError(404, 'Vaga não encontrada');
    res.json(job);
  });

  router.delete('/:id', (req, res) => {
    if (!store.jobs.delete(req.params.id)) {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    res.status(204).send();
  });

  return router;
}
