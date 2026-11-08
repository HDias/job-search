import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { runs } from '../../db/schema.js';
import { newId, nowIso } from '../../domain/ids.js';
import type {
  ClarificationEntry,
  LlmQuestion,
  NewRun,
  Run,
  RunFilter,
  RunPatch,
} from '../../domain/run.js';
import type { RunRepository } from '../types.js';
import {
  parseFit,
  parseJobSnapshot,
  rowToRun,
  runToRow,
} from './mappers.js';

/** Zod defaults are applied by the repository, not by the input type. */
function normalizeQuestion(
  value: NewRun['llmQuestion'] | RunPatch['llmQuestion'],
): LlmQuestion | null {
  if (!value) return null;
  return {
    question: value.question,
    options: value.options ?? [],
    blockingField: value.blockingField ?? '',
    kind: value.kind,
    inferences: value.inferences ?? [],
    rawExcerpt: value.rawExcerpt ?? '',
  };
}

function normalizeHistory(
  value: NewRun['clarificationHistory'] | RunPatch['clarificationHistory'],
): ClarificationEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    answer: entry.answer,
    approvedInferences: entry.approvedInferences ?? [],
    rejectedInferences: entry.rejectedInferences ?? [],
    at: entry.at,
  }));
}

export class SqliteRunRepository implements RunRepository {
  constructor(private readonly db: Db) {}

  list(filter: RunFilter = {}): Run[] {
    const clauses: SQL[] = [];
    if (filter.jobId) clauses.push(eq(runs.jobId, filter.jobId));
    if (filter.stage) clauses.push(eq(runs.stage, filter.stage));

    const where = clauses.length > 0 ? and(...clauses) : undefined;
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);

    return this.db
      .select()
      .from(runs)
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map(rowToRun);
  }

  get(id: string): Run | null {
    const row = this.db.select().from(runs).where(eq(runs.id, id)).get();
    return row ? rowToRun(row) : null;
  }

  create(input: NewRun): Run {
    const now = nowIso();
    const createdAt = input.createdAt ?? now;
    const run: Run = {
      id: input.id ?? newId('proc'),
      jobId: input.jobId ?? null,
      stage: input.stage ?? 'queued',
      url: input.url ?? null,
      stack: input.stack ?? null,
      languagePreference: input.languagePreference ?? null,
      detectedLanguage: input.detectedLanguage ?? null,
      suggestedLanguage: input.suggestedLanguage ?? null,
      needsLanguageConfirmation: input.needsLanguageConfirmation ?? false,
      needsFitConfirmation: input.needsFitConfirmation ?? false,
      eligibilityBlocked: input.eligibilityBlocked ?? false,
      hasRawText: input.hasRawText ?? false,
      hasExtraQuestions: input.hasExtraQuestions ?? false,
      hasRecruiterMessage: input.hasRecruiterMessage ?? false,
      error: input.error ?? null,
      fit: parseFit(input.fit),
      job: parseJobSnapshot(input.job),
      jobSnapshot: parseJobSnapshot(input.jobSnapshot),
      llmQuestion: normalizeQuestion(input.llmQuestion),
      needsInputRounds: input.needsInputRounds ?? 0,
      clarificationHistory: normalizeHistory(input.clarificationHistory),
      coverLetterGuidance: input.coverLetterGuidance ?? null,
      includeCoverInCv: input.includeCoverInCv ?? null,
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    };

    this.db.insert(runs).values(runToRow(run)).run();
    return this.get(run.id) as Run;
  }

  update(id: string, patch: RunPatch): Run | null {
    const current = this.get(id);
    if (!current) return null;

    const next: Run = {
      ...current,
      ...patch,
      fit: patch.fit === undefined ? current.fit : parseFit(patch.fit),
      job: patch.job === undefined ? current.job : parseJobSnapshot(patch.job),
      jobSnapshot:
        patch.jobSnapshot === undefined
          ? current.jobSnapshot
          : parseJobSnapshot(patch.jobSnapshot),
      llmQuestion:
        patch.llmQuestion === undefined
          ? current.llmQuestion
          : normalizeQuestion(patch.llmQuestion),
      needsInputRounds: patch.needsInputRounds ?? current.needsInputRounds,
      clarificationHistory:
        patch.clarificationHistory === undefined
          ? current.clarificationHistory
          : normalizeHistory(patch.clarificationHistory),
      coverLetterGuidance:
        patch.coverLetterGuidance === undefined
          ? current.coverLetterGuidance
          : patch.coverLetterGuidance,
      includeCoverInCv:
        patch.includeCoverInCv === undefined
          ? current.includeCoverInCv
          : patch.includeCoverInCv,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };

    const { id: _id, createdAt: _createdAt, ...row } = runToRow(next);
    this.db.update(runs).set(row).where(eq(runs.id, id)).run();
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.delete(runs).where(eq(runs.id, id)).run();
    return result.changes > 0;
  }
}
