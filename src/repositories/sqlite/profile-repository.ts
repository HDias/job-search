import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { profiles } from '../../db/schema.js';
import { nowIso } from '../../domain/ids.js';
import type { Profile } from '../../domain/profile.js';
import type { ProfileRepository } from '../types.js';

function rowToProfile(row: typeof profiles.$inferSelect): Profile {
  return {
    stack: row.stack,
    language: row.language,
    content: row.content,
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

  upsert(
    profile: Omit<Profile, 'updatedAt'> & { updatedAt?: string },
  ): Profile {
    const updatedAt = profile.updatedAt ?? nowIso();
    this.db
      .insert(profiles)
      .values({
        stack: profile.stack,
        language: profile.language,
        content: profile.content,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [profiles.stack, profiles.language],
        set: { content: profile.content, updatedAt },
      })
      .run();

    return {
      stack: profile.stack,
      language: profile.language,
      content: profile.content,
      updatedAt,
    };
  }
}
