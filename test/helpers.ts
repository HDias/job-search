import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { createStore } from '../src/repositories/sqlite/store.js';

export function createTestStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'job-search-v2-test-'));
  const dbFile = path.join(dir, 'test.db');
  const store = createStore(dbFile);
  runMigrations(store.db);

  return {
    dir,
    dbFile,
    store,
    cleanup(): void {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
