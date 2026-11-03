import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

export function defaultDbFile(): string {
  return process.env.DB_FILE ?? path.resolve('data/job-search.db');
}

function createDb(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, file };
}

export type OpenDatabase = ReturnType<typeof createDb>;

export function openDb(file = defaultDbFile()): OpenDatabase {
  return createDb(file);
}
