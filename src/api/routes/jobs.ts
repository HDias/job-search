import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import {
  applyConfirmInputSchema,
  JOB_STATUSES,
  jobPatchSchema,
  newJobSchema,
  type JobStatus,
} from '../../domain/job.js';
import { confirmApplication, NOT_APPROVED_MESSAGE } from '../../pipeline/apply/confirm.js';
import type { Store } from '../../repositories/types.js';
import { HttpError, parseBody } from '../http.js';

const statusSchema = z.enum(JOB_STATUSES);

function queryInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function createJobsRouter(
  store: Store,
  options: { applicationsDir?: string } = {},
): Router {
  const router = Router();

  /** Removes the kit folders (every regeneration) from disk, safely. */
  function removeArtifactFolders(jobId: string): void {
    const base = options.applicationsDir;
    if (!base) return;
    const root = path.resolve(base);
    const folders = new Set(
      store.artifacts
        .listByJob(jobId)
        .map((artifact) => String(artifact.relativePath ?? '').split('/')[0])
        .filter(Boolean),
    );
    for (const folder of folders) {
      const target = path.resolve(root, folder);
      if (!target.startsWith(root + path.sep)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

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

  router.post('/:id/apply-confirm', (req, res) => {
    const input = parseBody(applyConfirmInputSchema, req.body ?? {});
    const outcome = confirmApplication(store, req.params.id, input);

    if (outcome.status === 'not_found') {
      throw new HttpError(404, 'Vaga não encontrada');
    }
    if (outcome.status === 'not_approved') {
      throw new HttpError(400, NOT_APPROVED_MESSAGE);
    }

    res.json({ success: true, job: outcome.job });
  });

  router.delete('/:id', (req, res) => {
    const job = store.jobs.get(req.params.id);
    if (!job) {
      throw new HttpError(404, 'Vaga não encontrada');
    }

    // `?purge=true` is the permanent delete used by the dashboard: it also
    // removes the runs and the generated kit folders. Without it the legacy
    // behavior stays (runs become orphans, files remain on disk).
    const purge = req.query.purge === 'true' || req.query.purge === '1';
    if (purge) {
      store.runs.deleteByJob(job.id);
      removeArtifactFolders(job.id);
      store.artifacts.deleteByJob(job.id);
    }

    store.jobs.delete(job.id);
    res.status(204).send();
  });

  return router;
}
