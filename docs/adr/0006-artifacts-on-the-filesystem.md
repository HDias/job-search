# ADR-0006 — Artifacts on the filesystem

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Each application generates several files: resume in HTML and PDF, cover letter, email, recruiter
message, answer suggestions, questions JSON. They are binaries or large documents, which the v1
pipeline already writes under `applications/<slug>/`.

Storing everything as BLOBs in SQLite would simplify backups and transactions, but it would bloat
the database, worsen read performance and make serving over HTTP harder.

## Decision

- **Content on the filesystem**, in `APPLICATIONS_DIR` (default: the v1 app's `applications/`
  directory).
- **Metadata in the database**, in the `artifacts` table: `kind`, `relative_path`, `mime`,
  `size_bytes`, `job_id`, `run_id`, `created_at`.
- The path is always **relative** to the base directory; never absolute in the database.
- The server exposes `/applications/*` as static and validates path traversal in the viewers.
- The importer does not copy files: it only indexes the ones that exist.

## Consequences

**Positive**

- Small and fast database; backing up the database doesn't include PDFs.
- Serving files is `express.static`'s job: efficient, with HTTP caching.
- v1 and v2 share the same files during the migration.
- Moving to object storage (S3, Supabase Storage) means replacing `relativePath` with a URL/key.

**Negative**

- Database and disk can diverge: a record without a file (or the other way around). The viewers
  handle this with a warning message.
- Backups must include both.
- No transaction between the INSERT and the file write. Acceptable because the pipeline writes the
  file before registering it.
- In the cloud, object storage and signed URLs will be required.

**Invariants**

1. `relative_path` never starts with `/`.
2. The resolved `relative_path` must stay inside `APPLICATIONS_DIR`.
3. The unique index `(job_id, kind, relative_path)` prevents duplicates on re-import.

## References

- [data-model.md](../data-model.md)
- [security.md](../security.md)
