import { loadConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { createStore } from '../repositories/sqlite/store.js';
import { createApp } from './app.js';

const config = loadConfig();
const store = createStore(config.dbFile);
runMigrations(store.db);

const app = createApp({
  store,
  applicationsDir: config.applicationsDir,
  baseProfileDir: config.baseProfileDir,
  webDist: config.webDist,
});

const server = app.listen(config.port, () => {
  console.log(`[job-search-v2] API em http://localhost:${config.port}`);
  console.log(`[job-search-v2] banco: ${config.dbFile}`);
  console.log(`[job-search-v2] artefatos: ${config.applicationsDir}`);
  console.log(`[job-search-v2] web: ${config.webDist}`);
});

function shutdown(signal: string): void {
  console.log(`\n[job-search-v2] ${signal} recebido, encerrando...`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
