# ADR-0011 — Synchronous post-response chat

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

The pipeline answers once per run: fit-check, kit generation and the interactive `needs_input`
queue all finish with an artifact or a checkpoint. There was no way to keep talking about a job
after the kit exists — for example to summarise the fit, list the gaps or question the cover
letter. v1 only had the `needs_input` queue **during** generation, never a dialogue afterwards.

The feature needed to fit a local-first app with one Node process, a single SQLite file and an
in-process FIFO queue that runs one heavy task at a time (ADR-0010). It also had to reuse the
skill's grounding rules: the chat must not invent facts and must not rewrite artifacts.

## Decision

- **`POST /api/jobs/:id/chat` is synchronous.** The handler awaits the LLM and answers
  `{ reply, chat }` in the same request, like `/prefill` and `/questions`. It does **not** use the
  `202 + runId` queue: a conversation needs an immediate answer, and the one-slot FIFO would
  serialize the chat behind a kit generation for minutes.
- **The thread is document-shaped, one per job.** `jobs.chat_history` is a JSON array of
  `{ role, content, at }` turns. It survives fit/kit reruns and `regenerate`, and it is persisted
  by the repository like the other JSON columns (ADR-0002).
- **Context is grounded, not free-form.** The prompt carries the latest `jobSnapshot.content`
  (the scraped posting), the fit (rating, dimensions, strengths, gaps, analysis) and the last
  **12** turns. The system prompt always injects the zero-lies instruction and the skill's
  human-in-the-loop safety protocol, and forbids claiming a submission or rewriting artifacts.
- **Failures are atomic and sanitized.** The `user` turn is appended only together with the
  `assistant` reply; a failed LLM call persists nothing. Provider errors are redacted
  (`sk-…`, `key=…`) and the route answers a generic `500`, so the key never reaches the client.
- **Quick actions are client-side prompts.** "Resumir o fit", "Apontar gaps" and "Reescrever a
  carta" only send predefined text through the same route. They never regenerate artifacts — that
  stays with `POST /api/jobs/:id/regenerate` and `coverLetterGuidance`.

## Consequences

**Positive**

- The UI gets the answer in the same round-trip; no polling or SSE infrastructure is needed.
- The thread is bound to the job, so regenerating the kit does not erase the conversation.
- Grounding is enforced server-side, and the LLM key stays out of the chat surface.
- The module is injectable (`store`, skill loader, LLM client) and fully covered without network.

**Negative**

- A slow provider holds the request open; there is no streaming and no cancel.
- The single-slot queue is bypassed, so a chat call can compete with a running kit generation for
  the provider's rate limit.
- `chat_history` grows inside the row; only the last 12 turns reach the prompt, but the column
  itself is not pruned yet.
- The chat cannot change the kit; a "chat → regenerate" integration is explicit backlog.

## References

- [api.md §4.7](../api.md#47-post-response-chat--post-apijobsidchat) — route contract and gates
- [frontend.md §5](../frontend.md#5-components) — `ChatPanel` and quick actions
- [ADR-0002](./0002-document-shaped-model.md) — JSON columns
- [ADR-0010](./0010-async-pipeline.md) — why heavy work goes through the queue and the chat does not
