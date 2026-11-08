# ADR-0001 — SQLite in the backend, not in the browser

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

v1 kept its state in JSON files read and written by its Express server. The React
rewrite needs a structured data source, with queries and integrity, without losing the ability to
run locally with no infrastructure.

The alternatives considered were:

1. **SQLite in the browser** (sql.js, wa-sqlite, OPFS) — removes the backend, but duplicates rules
   and gets in the way of the Playwright/LLM pipeline, which is server-side.
2. **SQLite in the backend** — the server keeps owning the data and the pipeline.
3. **Postgres from the start** — closer to a hosted deployment, but adds infrastructure for a
   local app.

## Decision

SQLite runs **in the backend**, accessed via `better-sqlite3` + Drizzle ORM. The UI speaks HTTP,
never SQL. The file lives at `data/job-search.db` and is gitignored.

## Consequences

**Positive**

- A single process and a single file; trivial setup.
- The heavy pipeline stays in the same runtime as the database.
- Real transactions and referential integrity.

**Negative**

- There is no concurrent multi-user access.
- The frontend depends on the local network (acceptable for personal use).
- SQLite has `ALTER TABLE` limitations; schema changes require careful migrations.

**Neutral**

- The React HTTP client will be the same for any future backend.

## References

- [architecture.md](../architecture.md)
- [ADR-0003 — Repository pattern](./0003-repository-pattern.md)
