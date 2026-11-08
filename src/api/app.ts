import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { Store } from '../repositories/types.js';
import {
  createPipelineService,
  type PipelineService,
} from '../pipeline/service.js';
import { errorHandler, notFoundHandler } from './http.js';
import { createCompatRouter } from './routes/compat.js';
import { createJobsRouter } from './routes/jobs.js';
import { createMetaRouter } from './routes/meta.js';
import { createPipelineRouter } from './routes/pipeline.js';
import { createRunsRouter } from './routes/runs.js';
import { createViewersRouter } from './routes/viewers.js';

export interface CreateAppOptions {
  store: Store;
  applicationsDir?: string;
  baseProfileDir?: string;
  /** Build do React; quando presente, o Express serve a SPA. */
  webDist?: string;
  /** Skill assets directory (defaults to `<cwd>/skills`). */
  skillsDir?: string;
  /** Injectable pipeline (tests stub the LLM and the scraper). */
  pipeline?: PipelineService;
}

const RESERVED_PREFIX = /^\/(api|applications|base_profile|cv|extras)(\/|$)/;

export function createApp(options: CreateAppOptions): Express {
  const { store, applicationsDir, baseProfileDir, webDist } = options;
  const pipeline =
    options.pipeline ??
    createPipelineService({
      store,
      skillsDir: options.skillsDir ?? path.resolve('skills'),
    });
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
  app.use('/api', createPipelineRouter(store, pipeline));
  app.use('/api', createMetaRouter(store));
  app.use('/api', createCompatRouter(store));

  if (applicationsDir) {
    app.use('/applications', express.static(applicationsDir));
    app.use('/', createViewersRouter(store, applicationsDir));
  }

  if (baseProfileDir) {
    app.use('/base_profile', express.static(baseProfileDir));
  }

  if (webDist) {
    const indexFile = path.join(webDist, 'index.html');
    if (fs.existsSync(indexFile)) {
      app.use(express.static(webDist));

      // Fallback da SPA: qualquer rota de navegação devolve o index.
      // Prefixos da API, artefatos e visualizadores continuam dando 404.
      app.use((req, res, next) => {
        const isNavigation =
          req.method === 'GET' &&
          !RESERVED_PREFIX.test(req.path) &&
          Boolean(req.accepts('html'));
        if (!isNavigation) {
          next();
          return;
        }
        res.sendFile(indexFile);
      });
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
