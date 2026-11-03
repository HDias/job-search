import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { artifacts } from '../../db/schema.js';
import { newId, nowIso } from '../../domain/ids.js';
import type { Artifact } from '../../domain/artifact.js';
import type { ArtifactRepository, NewArtifact } from '../types.js';
import { rowToArtifact } from './mappers.js';

export class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: Db) {}

  listByJob(jobId: string): Artifact[] {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.jobId, jobId))
      .orderBy(desc(artifacts.kind))
      .all()
      .map(rowToArtifact);
  }

  addMany(inputs: NewArtifact[]): void {
    if (inputs.length === 0) return;

    const rows = inputs.map((input) => ({
      id: input.id ?? newId('art'),
      jobId: input.jobId,
      runId: input.runId ?? null,
      kind: input.kind,
      relativePath: input.relativePath,
      mime: input.mime ?? null,
      sizeBytes: input.sizeBytes ?? null,
      createdAt: input.createdAt ?? nowIso(),
    }));

    this.db.insert(artifacts).values(rows).onConflictDoNothing().run();
  }

  deleteByJob(jobId: string): void {
    this.db.delete(artifacts).where(eq(artifacts.jobId, jobId)).run();
  }
}
