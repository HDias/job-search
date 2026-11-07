# ADR-0009 — Configurable targets in `profiles`

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

The v1 UI assumed exactly four fixed base resumes (`pt-br`, `en`, `php-pt-br`, `php-en`), derived
from two stacks (Ruby and PHP) and two languages. v2 needed to allow new combinations without
changing the schema for every stack, while also storing per-target prompt instructions for the
future pipeline.

It was necessary to decide where to model a "target" and how to remove/deactivate one without
losing the resume.

## Decision

- **Target = one row in `profiles`**, identified by the composite key `(stack, language)`. There
  is no separate targets table.
- `stack` is a free slug (`^[a-z][a-z0-9-]{0,31}$`); `language` stays limited to the `LANGUAGES`
  enum (`pt-br`, `en`).
- The table gained two additive columns:
  - `enabled` (`INTEGER` boolean, default `true`): the future pipeline only considers active targets.
  - `extra_prompt` (`TEXT`, nullable): style/emphasis instructions appended to the fit and tailor
    prompts. **It is not a source of facts**; grounding stays in the base resume.
- The API exposes `GET/POST/PUT/DELETE /api/profiles`, with partial `PUT` (missing fields
  preserved) and `409` on duplicate creation.
- Removing a target deletes the row and the stored resume. The non-destructive alternative is
  `enabled = false`.
- `/api/base-resumes` keeps the legacy four-key format for v1; the new UI uses `/api/profiles`.
- Consuming `extraPrompt` in the pipeline is deferred to Phase 3.

## Consequences

**Positive**

- Adding a stack is just creating a row; no new migration.
- The document-shaped model is preserved: the resume stays in `content`, without excessive
  normalization.
- Deactivating and removing have distinct semantics, explicit in the UI.
- The four targets imported from v1 stay active thanks to the `enabled = true` default.

**Negative**

- A free-form `stack` requires validation at the boundary (Zod + slug) and doesn't prevent
  "valid but wrong" stacks.
- Natural language stays restricted to `pt-br`/`en`; adding `es`/`fr` requires extending
  `LANGUAGES`, the language gate and the UI.
- Removing is destructive for the resume; the UI confirms, but there is no trash or soft delete.
- The pipeline does not read `enabled`/`extraPrompt` yet; until Phase 3 the effect is purely
  configuration.

## References

- [api.md](../api.md) — `profiles` endpoints
- [data-model.md](../data-model.md) — `enabled` and `extra_prompt` columns
- [frontend.md](../frontend.md) — App Settings page
- [ADR-0002](./0002-document-shaped-model.md) — document-shaped model
