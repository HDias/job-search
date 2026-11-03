import { and, avg, count, desc, eq, gte, isNotNull, like, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { jobs } from '../../db/schema.js';
import { nowIso, newId } from '../../domain/ids.js';
import {
  fitSchema,
  type Job,
  type JobFilter,
  type JobList,
  type JobPatch,
  type JobStats,
  type NewJob,
} from '../../domain/job.js';
import type { JobRepository } from '../types.js';
import { jobToRow, rowToJob } from './mappers.js';

function normalizeFit(fit: NewJob['fit']): Job['fit'] {
  if (fit === null || fit === undefined) return null;
  const parsed = fitSchema.safeParse(fit);
  return parsed.success ? parsed.data : null;
}

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: Db) {}

  list(filter: JobFilter = {}): JobList {
    const clauses: SQL[] = [];

    if (filter.ownerId) clauses.push(eq(jobs.ownerId, filter.ownerId));
    if (filter.status) clauses.push(eq(jobs.status, filter.status));
    if (filter.q) {
      const needle = `%${filter.q}%`;
      clauses.push(
        or(
          like(jobs.company, needle),
          like(jobs.role, needle),
          like(jobs.fitAnalysis, needle),
        ) as SQL,
      );
    }

    const where = clauses.length > 0 ? and(...clauses) : undefined;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const rows = this.db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.appliedAt), desc(jobs.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const totalRow = this.db
      .select({ value: count() })
      .from(jobs)
      .where(where)
      .get();

    return {
      items: rows.map(rowToJob),
      total: Number(totalRow?.value ?? 0),
    };
  }

  get(id: string): Job | null {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? rowToJob(row) : null;
  }

  create(input: NewJob): Job {
    const now = nowIso();
    const createdAt = input.createdAt ?? now;
    const job: Job = {
      id: input.id ?? newId('app'),
      ownerId: input.ownerId ?? 'local',
      company: input.company,
      role: input.role,
      vacancyUrl: input.vacancyUrl ?? null,
      applyUrl: input.applyUrl ?? null,
      language: input.language ?? 'pt-br',
      stack: input.stack ?? 'ruby',
      channel: input.channel ?? null,
      status: input.status ?? 'drafted',
      appliedAt: input.appliedAt ?? null,
      fit: normalizeFit(input.fit),
      appliedEmails: input.appliedEmails ?? [],
      coverLetterGuidance: input.coverLetterGuidance ?? null,
      coverInCvRequired: input.coverInCvRequired ?? null,
      coverInCvReason: input.coverInCvReason ?? null,
      hasRecruiterMessage: input.hasRecruiterMessage ?? false,
      hasQuestions: input.hasQuestions ?? false,
      skillGrounded: input.skillGrounded ?? null,
      fitConfirmed: input.fitConfirmed ?? null,
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    };

    this.db.insert(jobs).values(jobToRow(job)).run();
    return this.get(job.id) as Job;
  }

  update(id: string, patch: JobPatch): Job | null {
    const current = this.get(id);
    if (!current) return null;

    const next: Job = {
      ...current,
      ...patch,
      fit: patch.fit === undefined ? current.fit : normalizeFit(patch.fit),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };

    const { id: _id, createdAt: _createdAt, ...row } = jobToRow(next);
    this.db.update(jobs).set(row).where(eq(jobs.id, id)).run();
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.delete(jobs).where(eq(jobs.id, id)).run();
    return result.changes > 0;
  }

  stats(ownerId = 'local'): JobStats {
    const owner = eq(jobs.ownerId, ownerId);

    const byStatusRows = this.db
      .select({ status: jobs.status, total: count() })
      .from(jobs)
      .where(owner)
      .groupBy(jobs.status)
      .all();

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of byStatusRows) {
      byStatus[row.status] = Number(row.total);
      total += Number(row.total);
    }

    const avgRow = this.db
      .select({ value: avg(jobs.fitRating) })
      .from(jobs)
      .where(and(owner, isNotNull(jobs.fitRating)))
      .get();

    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentRow = this.db
      .select({ value: count() })
      .from(jobs)
      .where(and(owner, gte(jobs.appliedAt, threshold)))
      .get();

    return {
      total,
      byStatus,
      averageFitRating:
        avgRow?.value === null || avgRow?.value === undefined
          ? null
          : Number(avgRow.value),
      appliedLast30Days: Number(recentRow?.value ?? 0),
    };
  }
}
