# Testing

## 1. Overview

Backend (root):

```text
Test Files  7 passed (7)
Tests      103 passed (103)
```

Frontend (`web/`):

```text
Test Files  6 passed (6)
Tests      28 passed (28)
```

| File | Tests | Covers |
|---|---:|---|
| `test/repositories.test.ts` | 15 | Repository contracts, CRUD, filters, stats, cascades |
| `test/from-json.test.ts` | 6 | Importer, normalization of dates/status/fit, imported fields |
| `test/api.test.ts` | 15 | REST routes, compatibility, viewers, errors |
| `test/requests.test.ts` | 35 | All HTTP routes, pagination, validation, 404, transport and SPA |
| `test/llm-client.test.ts` | 10 | Provider dispatch, retry/backoff, error messages |
| `test/llm-config.test.ts` | 7 | Partial merge, key masking, environment fallback |
| `test/pipeline-targets.test.ts` | 15 | Skill loader, prompt assembly and `extraPrompt` injection |

Runner: **Vitest 4**. HTTP: **Supertest 7**. Repository and HTTP tests use their own temporary
SQLite database.

## 2. How to run

```bash
pnpm test            # backend (Vitest, Node environment)
pnpm test:watch      # backend in watch mode
pnpm test:web        # frontend (Vitest, jsdom environment)
pnpm typecheck
pnpm typecheck:web
```

Filters:

```bash
pnpm test -- api
pnpm test -- -t "stats"
pnpm test:web -- Dashboard
```

There is no need to run the API or populate the real database: the backend tests create temporary
SQLite and the frontend tests mock `fetch`.

## 3. Isolation

`test/helpers.ts` exposes `createTestStore()`:

```ts
const ctx = createTestStore();
// ctx.store  → Store with repositories
// ctx.dir    → temporary directory (artifacts, profiles)
// ctx.cleanup() → closes the database and removes the directory
```

Each `beforeEach` creates a fresh store; each `afterEach` calls `cleanup()`. This allows running in
parallel without file collisions.

## 4. What the tests guarantee

### Repositories (`repositories.test.ts`)

- Job creation with correct defaults (`stack: ruby`, `status: drafted`,
  `languageConfirmation: null`).
- `list` with status filter, text search and pagination.
- Partial `update` preserves fields that were not sent.
- `delete` removes the job and cascades artifacts; runs are left with `job_id = NULL`.
- `stats` counts by status, averages fit and counts the last 30 days.
- Runs store `stack`, `job` and the full `jobSnapshot` (`content`, `extraQuestions`,
  `recruiterMessage`).
- Profiles and settings do upsert and read.
- The artifacts unique index prevents duplicates on `(jobId, kind, relativePath)`.

### Import (`from-json.test.ts`)

- `28/10/2026` becomes ISO 8601 UTC.
- Old status values (`encerrado`, `aplicado`…) become the new enum.
- The flattened fit becomes a `Fit` object.
- `languageConfirmation` is preserved.
- The run's full snapshot is imported, not just title/company.
- Invalid dates become `null` with a warning, without breaking the import.

### API (`api.test.ts`)

- `GET /api/health` and `/api/stats`.
- `GET /api/jobs` with a valid filter; `400` for invalid status.
- `GET /api/jobs/:id` returns job + runs + artifacts; `404` when it doesn't exist.
- Full job CRUD, including invalid body → `400`.
- `PATCH /api/runs/:id` preserves the snapshot.
- `GET /api/applications` in the legacy DTO: `dd/mm/yyyy` date, `fitRating`, `fitDimensions`,
  file paths and LinkedIn ↔ recruiter fallback.
- `PUT /api/applications/:id` converts old status and merges the fit without erasing the rest.
- `GET /api/processes` hides `done` runs.
- `PUT /api/processes/:id` detaches the job (`applicationId: null`).
- `DELETE` of applications and processes.
- Static PDF and `/cv/:id` with the download bar.
- `/extras/:id/:view` for email, recruiter and invalid view.
- `base-resumes`, `pdf-theme` (including invalid color → `400`), `candidate-data`.
- Profiles, generic settings and `404` for an unknown route.

### Requests (`requests.test.ts`)

A suite dedicated to exercising **every HTTP route** and the edge cases the UI will hit:

- Empty list and zeroed `stats` on a fresh database.
- Text search, status filter, pagination and invalid `limit`.
- Minimal creation with defaults (`ownerId`, `language`, `stack`, `status`, `appliedEmails`).
- Dates outside ISO and empty fields → `400`.
- Run CRUD (create, update, delete) and `jobId`/`stage` filters.
- `base-resumes` without profiles; `pdf-theme` with partial merge; partial `candidate-data`.
- Upsert of profiles and settings, including a body without `value` → `400`.
- Compatibility: empty lists, artifact fields, unknown status ignored, run detachment and
  `404` on missing resources.
- Viewers: CV without file → `404` with a friendly page, extras in text/escaped JSON, missing
  material → `200` with a warning.
- **Transport**: malformed JSON → `400`, body above 4 MB → `413`, path traversal blocked, form
  without required fields → `400`, unknown route → `404`.

### Pipeline (`llm-client.test.ts`, `llm-config.test.ts`, `pipeline-targets.test.ts`)

- `createLlmClient().call()` dispatches to Gemini, OpenAI/NVIDIA/OpenAI-compatible and Anthropic
  with the right endpoint, headers and payload.
- Retry/backoff on 429/5xx and transient messages; no retry on permanent errors.
- `loadLlmConfig` / `saveLlmConfig` partial semantics (`undefined` preserves, `null` clears,
  `apiKey: ""` keeps) and the `GEMINI_API_KEY` fallback.
- `createSkillLoader` reads `SKILL.md` and the references with caching and tolerates missing files.
- `targetSystemPrompts` skips disabled profiles and appends `extraPrompt` to both prompts.

### Frontend (`web/src/**/*.test.tsx`)

| File | Tests | Covers |
|---|---:|---|
| `web/src/lib/format.test.ts` | 5 | Dates, fit, bytes, labels and artifact URLs |
| `web/src/lib/runs.test.ts` | 4 | Active run, pending confirmation and language/fit priority |
| `web/src/pages/Dashboard.test.tsx` | 7 | Stats, table, filters, URL, pagination, empty and error |
| `web/src/pages/JobDetail.test.tsx` | 3 | Fit, runs, artifacts, status PATCH and 404 |
| `web/src/pages/Admin.test.tsx` | 3 | Base resumes, PDF theme and form data |
| `web/src/pages/AppSettings.test.tsx` | 6 | Target CRUD, `extraPrompt`, enable/disable and errors |

`fetch` is mocked with responses in the API's format. The tests use `MemoryRouter` and a
`QueryClient` without retry. The 4 s polling is not exercised with timers: the "active run" rule
is tested in isolation in `runs.test.ts`.

## 5. What is not tested

| Area | Risk | Reason |
|---|---|---|
| Playwright scraping and PDF generation | High | Not ported |
| Live LLM calls | Medium | The client is tested with a fake `fetch`; the suite never hits a provider |
| Authentication | High when exposed beyond localhost | Doesn't exist today |
| Write concurrency | Medium | Local single-user use |
| Real database migration | Medium | Manual smoke test, not automated |
| Checkpoint response in v2 | Medium | Depends on the ported pipeline |
| PDF resume upload | Medium | Extraction still depends on the previous server |
| Performance at volume | Low today | 16 jobs; N+1 tolerated |

## 6. Adding tests

### Repository

```ts
it('filtra por status', () => {
  const { store } = createTestStore();
  store.jobs.create({ company: 'Acme', role: 'Dev', status: 'applied' });
  const page = store.jobs.list({ status: 'applied' });
  expect(page.total).toBe(1);
});
```

### Route

```ts
it('responde 404 para vaga inexistente', async () => {
  const app = createApp({ store: ctx.store });
  const res = await request(app).get('/api/jobs/app_x');
  expect(res.status).toBe(404);
});
```

Prefer testing at the **HTTP boundary** when the behavior involves validation or DTOs; test the
repository directly when the target is SQL/filters/cascades.

## 7. Contract for adapters

The repository tests are the contract any future storage adapter must satisfy. The idea is to run
the same suite against the new adapter before switching the production default. See
[ADR-0003](./adr/0003-repository-pattern.md).
