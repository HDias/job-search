import express, { type Express } from 'express';
import type { Store } from '../repositories/types.js';
import { errorHandler, notFoundHandler } from './http.js';
import { createCompatRouter } from './routes/compat.js';
import { createJobsRouter } from './routes/jobs.js';
import { createMetaRouter } from './routes/meta.js';
import { createRunsRouter } from './routes/runs.js';
import { createViewersRouter } from './routes/viewers.js';

export interface CreateAppOptions {
  store: Store;
  applicationsDir?: string;
  baseProfileDir?: string;
}

export function createApp(options: CreateAppOptions): Express {
  const { store, applicationsDir, baseProfileDir } = options;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'job-search-v2',
      time: new Date().toISOString(),
    });
  });

  app.get('/api/stats', (_req, res) => {
    res.json(store.jobs.stats());
  });

  app.use('/api/jobs', createJobsRouter(store));
  app.use('/api/runs', createRunsRouter(store));
  app.use('/api', createMetaRouter(store));
  app.use('/api', createCompatRouter(store));

  if (applicationsDir) {
    app.use('/applications', express.static(applicationsDir));
    app.use('/', createViewersRouter(store, applicationsDir));
  }

  if (baseProfileDir) {
    app.use('/base_profile', express.static(baseProfileDir));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
