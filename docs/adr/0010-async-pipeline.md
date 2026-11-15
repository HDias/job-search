# ADR-0010 — Asynchronous pipeline in v2

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

v1 runs the whole application pipeline inside one long HTTP request (`processJob`): scrape → fit
→ LLM kit → PDF → artifacts. A slow provider or a blocked page keeps the request open for minutes,
there is no place to persist a mid-run question, and a restart loses everything. v2 needed the same
pipeline without inheriting that shape, while remaining a local-first app with a single Node
process and SQLite.

Two extra forces shaped the decision:

- The React UI already polls the job aggregate every 4 s, so it can follow a run without
  WebSockets or server-sent events.
- The pipeline must stay testable without Chromium, network or an LLM provider.

## Decision

- **`202 { runId }` for every heavy operation.** `POST /api/fit-check`, `POST /api/generate-kit` and
  `POST /api/jobs/:id/regenerate` create/reset a `run`, answer immediately and let the client poll
  `GET /api/jobs/:id` or `GET /api/runs/:id`. Runtime work never happens in the request handler.
- **One in-process FIFO worker, one execution at a time.** No external broker, no worker threads.
  A failing job marks the run `failed` and the queue moves on.
- **Checkpoints are rows in `runs`**, never files. Stage vocabulary:
  `queued → scraping → scrape-thin | fit-checked → generating ⇄ needs_input → done | failed`.
  `failed` and `needs_input` are resumable; the queue keeps no state across restarts.
- **The interactive queue is part of the API.** A run that cannot be grounded becomes `needs_input`
  with an `llmQuestion`; `GET /api/runs/:id/question` returns it and `POST /api/runs/:id/respond`
  resumes the same checkpoint. At most **2** rounds, `clarificationHistory` keeps the last **2**
  entries (2000 chars each), only `confidence: "high"` inferences can be approved, and replaying a
  pending question without a new answer makes **zero** LLM calls.
- **Gates answer `409` before the queue** (explicit language, `fit.rating < 50` or failed
  eligibility without confirmation, posting explicitly requiring another language) so the UI can
  ask the user instead of failing inside a worker.
- **Artifacts stay on the filesystem, metadata in `artifacts`** (ADR-0006). The kit writer owns the
  folder (`applications/<company>_<role>[_N]`) and records relative paths, mime and size.
- **Everything external is injected**: `fetch`, `sleep`, `browserFactory`, the LLM client and the
  `pdftotext` runner. The suite never launches Chromium, never hits a provider and never parses a
  real PDF.
- **The LLM key never leaves the server** (ADR-0004, D4/D13): `GET /api/llm-config` returns
  `hasKey` + `maskedKey`, an empty `apiKey` preserves the stored one, and no log or error message
  contains it.

## Consequences

**Positive**

- Requests stay short; the UI shows progress through the existing polling and survives reloads.
- A blocked run is visible and answerable in the SPA instead of failing silently.
- Restart safety comes from `runs` alone; no serialized queue file to keep in sync.
- The queue, the markers and the worker are replaceable: swapping SQLite for a cloud store only
  touches the repositories.
- Tests are deterministic and fast: 285 backend tests run in a few seconds.

**Negative**

- The FIFO worker is in-process: a crash loses queued work, and there is no retry/backoff beyond
  the LLM client's own retries.
- One execution at a time keeps the API simple but serializes unrelated jobs.
- Polling costs one aggregate request every 4 s per open detail page; a push channel would be
  cheaper.
- The `needs_input` protocol adds two routes and a whitelist of approvable inferences that must be
  kept in sync between backend and UI.

## References

- [api.md §4](../api.md) — async endpoints, gates and the interactive queue
- [architecture.md §7](../architecture.md#7-pipeline-llm-and-skills) — module map and flow
- [ADR-0004](./0004-strangler-strategy-v1-compatibility.md) — compatibility during the migration
- [ADR-0006](./0006-artifacts-on-the-filesystem.md) — artifacts on disk
- [ADR-0009](./0009-configurable-targets.md) — targets, `enabled` and `extraPrompt`
