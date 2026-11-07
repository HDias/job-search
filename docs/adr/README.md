# Architecture Decision Records

Record of v2's structural decisions. Each ADR is short, has context, decision and consequences,
and **is not rewritten** — when a decision changes, another ADR is created that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-sqlite-in-backend.md) | SQLite in the backend, not in the browser | Accepted |
| [0002](./0002-document-shaped-model.md) | Document-shaped model to ease the cloud move | Accepted |
| [0003](./0003-repository-pattern-and-cloud.md) | Repository pattern and cloud path | Accepted |
| [0004](./0004-strangler-strategy-v1-compatibility.md) | Strangler with a compatibility layer | Accepted |
| [0005](./0005-identity-datas-and-nulls.md) | Prefixed IDs, ISO 8601 and `null` | Accepted |
| [0006](./0006-artifacts-on-the-filesystem.md) | Artifacts on the filesystem, metadata in the database | Accepted |
| [0007](./0007-zod-at-the-http-boundary.md) | Zod at the HTTP boundary | Accepted |
| [0008](./0008-vitest-supertest.md) | Vitest + Supertest | Accepted |
| [0009](./0009-configurable-targets.md) | Configurable targets in `profiles` | Accepted |

## Format

```markdown
# ADR-000N — Title

- **Status:** Accepted | Superseded by ADR-XXXX | Rejected
- **Date:** YYYY-MM-DD
- **Context:** ...

## Decision
...

## Consequences
...
```

## When to write an ADR

- Swapping the database, framework or runtime.
- Change to the ID format, dates or null handling.
- A new architectural layer.
- A decision that will be expensive to reverse.
- Any likely future "why did they do it this way?".

Don't write an ADR for local implementation details, variable names or bug fixes.
