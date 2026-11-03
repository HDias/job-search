import { defaultDbFile, openDb } from '../../db/client.js';
import { SqliteArtifactRepository } from './artifact-repository.js';
import { SqliteJobRepository } from './job-repository.js';
import { SqliteProfileRepository } from './profile-repository.js';
import { SqliteRunRepository } from './run-repository.js';
import { SqliteSettingsRepository } from './settings-repository.js';

/**
 * Única porta de entrada para a persistência. Para migrar para Firestore/Turso
 * depois, basta criar outra implementação das interfaces de repositório.
 */
export function createStore(file = defaultDbFile()) {
  const { db, sqlite, file: resolvedFile } = openDb(file);

  return {
    db,
    sqlite,
    file: resolvedFile,
    jobs: new SqliteJobRepository(db),
    runs: new SqliteRunRepository(db),
    artifacts: new SqliteArtifactRepository(db),
    profiles: new SqliteProfileRepository(db),
    settings: new SqliteSettingsRepository(db),
    transaction<T>(fn: () => T): T {
      return sqlite.transaction(fn)();
    },
    close(): void {
      sqlite.close();
    },
  };
}

export type SqliteStore = ReturnType<typeof createStore>;
