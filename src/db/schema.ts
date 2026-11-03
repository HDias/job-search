import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { Fit } from '../domain/job.js';
import type { JobSnapshot } from '../domain/run.js';

/**
 * Modelo "document-shaped": entidades agregadas ficam em uma linha, com os
 * campos aninhados em JSON. Menos JOINs e migração quase direta para Firestore.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('local'),
    company: text('company').notNull(),
    role: text('role').notNull(),
    vacancyUrl: text('vacancy_url'),
    applyUrl: text('apply_url'),
    language: text('language').notNull().default('pt-br'),
    stack: text('stack').notNull().default('ruby'),
    channel: text('channel'),
    languageConfirmation: text('language_confirmation'),
    status: text('status').notNull().default('drafted'),
    /** ISO 8601 (a data dd/mm/yyyy do v1 é convertida na importação). */
    appliedAt: text('applied_at'),
    fitRating: real('fit_rating'),
    fitAnalysis: text('fit_analysis'),
    fitJson: text('fit_json', { mode: 'json' }).$type<Fit>(),
    appliedEmails: text('applied_emails', { mode: 'json' }).$type<string[]>(),
    coverLetterGuidance: text('cover_letter_guidance'),
    coverInCvRequired: integer('cover_in_cv_required', { mode: 'boolean' }),
    coverInCvReason: text('cover_in_cv_reason'),
    hasRecruiterMessage: integer('has_recruiter_message', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasQuestions: integer('has_questions', { mode: 'boolean' })
      .notNull()
      .default(false),
    skillGrounded: integer('skill_grounded', { mode: 'boolean' }),
    fitConfirmed: integer('fit_confirmed', { mode: 'boolean' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('jobs_owner_idx').on(table.ownerId),
    index('jobs_status_idx').on(table.status),
    index('jobs_applied_at_idx').on(table.appliedAt),
    index('jobs_company_idx').on(table.company),
  ],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    stage: text('stage').notNull().default('draft'),
    url: text('url'),
    stack: text('stack'),
    languagePreference: text('language_preference'),
    detectedLanguage: text('detected_language'),
    suggestedLanguage: text('suggested_language'),
    needsLanguageConfirmation: integer('needs_language_confirmation', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    needsFitConfirmation: integer('needs_fit_confirmation', { mode: 'boolean' })
      .notNull()
      .default(false),
    eligibilityBlocked: integer('eligibility_blocked', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasRawText: integer('has_raw_text', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasExtraQuestions: integer('has_extra_questions', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasRecruiterMessage: integer('has_recruiter_message', { mode: 'boolean' })
      .notNull()
      .default(false),
    error: text('error'),
    fitJson: text('fit_json', { mode: 'json' }).$type<Fit>(),
    /** Metadados da vaga no momento do processamento (v1: `job`). */
    jobJson: text('job_json', { mode: 'json' }).$type<JobSnapshot>(),
    /** Snapshot completo, incluindo `content` (v1: `jobSnapshot`). */
    jobSnapshot: text('job_snapshot', { mode: 'json' }).$type<JobSnapshot>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('runs_job_idx').on(table.jobId),
    index('runs_stage_idx').on(table.stage),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    /** Relativo a data/applications — nunca um blob dentro do banco. */
    relativePath: text('relative_path').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('artifacts_job_idx').on(table.jobId),
    index('artifacts_kind_idx').on(table.kind),
    uniqueIndex('artifacts_job_kind_path_uq').on(
      table.jobId,
      table.kind,
      table.relativePath,
    ),
  ],
);

export const profiles = sqliteTable(
  'profiles',
  {
    stack: text('stack').notNull(),
    language: text('language').notNull(),
    content: text('content', { mode: 'json' }).$type<unknown>(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.stack, table.language] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
  updatedAt: text('updated_at').notNull(),
});

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
