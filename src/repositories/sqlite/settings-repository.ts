import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { nowIso } from '../../domain/ids.js';
import type { SettingsEntry } from '../../domain/profile.js';
import type { SettingsRepository } from '../types.js';

function rowToEntry(row: typeof settings.$inferSelect): SettingsEntry {
  return { key: row.key, value: row.value, updatedAt: row.updatedAt };
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Db) {}

  list(): SettingsEntry[] {
    return this.db.select().from(settings).all().map(rowToEntry);
  }

  get<T = unknown>(key: string): T | null {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row ? (row.value as T) : null;
  }

  set(key: string, value: unknown): SettingsEntry {
    const updatedAt = nowIso();
    this.db
      .insert(settings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt },
      })
      .run();

    return { key, value, updatedAt };
  }

  delete(key: string): boolean {
    const result = this.db.delete(settings).where(eq(settings.key, key)).run();
    return result.changes > 0;
  }
}
