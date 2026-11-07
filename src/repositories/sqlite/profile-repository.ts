import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { profiles } from '../../db/schema.js';
import { nowIso } from '../../domain/ids.js';
import type { Profile, UpsertProfileInput } from '../../domain/profile.js';
import type { ProfileRepository } from '../types.js';

function rowToProfile(row: typeof profiles.$inferSelect): Profile {
  return {
    stack: row.stack,
    language: row.language,
    content: row.content,
    enabled: row.enabled,
    extraPrompt: row.extraPrompt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly db: Db) {}

  list(): Profile[] {
    return this.db.select().from(profiles).all().map(rowToProfile);
  }

  get(stack: string, language: string): Profile | null {
    const row = this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.stack, stack), eq(profiles.language, language)))
      .get();
    return row ? rowToProfile(row) : null;
  }

  upsert(input: UpsertProfileInput): Profile {
    const updatedAt = input.updatedAt ?? nowIso();
    const insertValues = {
      stack: input.stack,
      language: input.language,
      content: input.content ?? null,
      enabled: input.enabled ?? true,
      extraPrompt: input.extraPrompt ?? null,
      updatedAt,
    };

    // Só sobrescreve o que foi enviado (semântica de PATCH).
    const set: Record<string, unknown> = { updatedAt };
    if (input.content !== undefined) set.content = input.content;
    if (input.enabled !== undefined) set.enabled = input.enabled;
    if (input.extraPrompt !== undefined) set.extraPrompt = input.extraPrompt;

    this.db
      .insert(profiles)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [profiles.stack, profiles.language],
        set,
      })
      .run();

    return this.get(input.stack, input.language) as Profile;
  }

  delete(stack: string, language: string): boolean {
    const result = this.db
      .delete(profiles)
      .where(and(eq(profiles.stack, stack), eq(profiles.language, language)))
      .run();
    return result.changes > 0;
  }
}
