---
description: Execute a plan using TDD and keeping its status checklist up to date
agent: build
---

Implement the plan: $1

`$1` may be a plan file, a plan name under `.plans/`, or a folder containing `plan.md`.
Resolve it in this order: `$1` as given, `.plans/$1`, `.plans/$1.md`, `$1/plan.md`,
`.plans/$1/plan.md`.

## Source of truth and resume

- The plan file is the source of truth. If context is compacted, re-read it.
- Resume from the FIRST unchecked task (`- [ ]`) in the plan's status section — usually
  `## 3. Estado por fase` with the `[x] feito · [ ] pendente · [~] parcial` legend, or a
  `## Execution status` section. Do not start over.
- `[~]` (partial) counts as not done: finish it before moving on.
- If `$1` is empty or no plan file exists, ask the user for the plan before starting.
- If the plan has no checklist/status section, add one with the remaining tasks before
  writing code, so progress survives compaction.

## Mandatory rules (project conventions — see AGENTS.md)

1. Before each major action, state the current task explicitly:
   `## Working: <task-id> — <title>`. This keeps the current state visible across
   compaction.
2. TDD is MANDATORY and strictly test-first, one behavior at a time:
   write the test → RUN it → confirm it fails for the expected reason (capture the red
   output) → write the minimum code to pass (green) → refactor → run again. NEVER write
   production code before observing the red test. A test that passes on its first run is
   invalid: fix the test before continuing. Bug fixes start with a failing regression
   test.
3. Run the narrowest test while iterating (`pnpm test -- <file>` or `pnpm test -- -t "<name>"`;
   `pnpm test:web -- <name>` for the frontend). Never launch Chromium in the suite: inject
   stubs for `fetch`, LLM, scrape and browser.
4. ESM + `module: NodeNext`: every relative TypeScript import needs the `.js` extension in
   `src/` and `test/`.
5. Persistence only through `src/repositories/types.ts`. Add a method to the interface and
   implement it in `src/repositories/sqlite/`; do not import Drizzle anywhere else.
6. Schema changes: edit `src/db/schema.ts`, then
   `pnpm exec drizzle-kit generate --name=...`. Never edit already-applied SQL in `drizzle/`.
   The backend migrates on boot; no separate migrate step is required.
7. Domain field changes must update both sides: `src/domain/` and `web/src/api/types.ts`.
8. Frontend: keep filters/page in the URL, TanStack Query for server state, own CSS. Do not
   add a UI library, Redux/Zustand or `dangerouslySetInnerHTML` without an explicit need.
9. Do not copy base resumes or generated artifacts into the repo (`APPLICATIONS_DIR` and
   `BASE_PROFILE_DIR` live outside it). Do not remove or build on top of the
   `/api/applications` and `/api/processes` compatibility DTOs.
10. All code comments, docs, test descriptions and plan updates are written in English, even
    when the plan itself is in Portuguese.

## Progress tracking

- When a task is done, check it off (`- [x]`) in the plan's status section with its
  "done when" evidence, including the exact test command and its passing result. A task with
  no test evidence is NOT done.
- Mark partially completed work `[~]` with a one-line note on what remains.
- No separate progress file. Keep the plan as the single source of truth.

## Verification gates (per task and at the end)

Run these before declaring a task done; rerun the full gate at each phase boundary:

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # if web/ was touched
pnpm build:web                        # if the change affects the build
```

`pnpm test` only includes `test/**/*.test.ts`; frontend tests run through
`web/vite.config.ts` (jsdom). Never add `web/` tests to the root config.

## Checkpoints (stop and wait for the user)

- Stop ONLY at decision gates and phase boundaries — not after every task.
- At a gate, present Pass/Adjust/Abort and wait for the user's choice.
- Between phases ask: "Phase done. Continue to the next phase? (continue / adjust / stop)".
- If the red phase cannot be observed (test passes immediately or fails for the wrong reason),
  stop and fix the test — do not proceed to implementation.
- When a failure scenario triggers, apply the plan's recovery cascade.

## Final step

- If no plan file exists or the plan was never saved, ask the user whether they want the final
  result documented before creating a file.
- If a plan file exists, ensure every completed task is checked in its status section.
- Verify whether existing documentation became inaccurate (README, `docs/`, `AGENTS.md`,
  `docs/api.md`). Update only those; do not create new documentation files unless the user
  explicitly asks.
