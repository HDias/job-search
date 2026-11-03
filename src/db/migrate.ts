import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';
import { defaultDbFile, openDb } from './client.js';

export const MIGRATIONS_FOLDER = path.resolve('drizzle');

export function runMigrations(db: Db, folder = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder: folder });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const file = defaultDbFile();
  const { db, sqlite } = openDb(file);
  runMigrations(db);
  sqlite.close();
  console.log(`Migrations aplicadas em ${file}`);
}
