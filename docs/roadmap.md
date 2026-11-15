# Roadmap

## 1. Phases

```mermaid
flowchart LR
  F0["Phase 0 - Data and import"]:::done
  F1["Phase 1 - SQLite and API"]:::done
  F2["Phase 2 - React"]:::done
  F3["Phase 3 - Pipeline port"]:::done

  F0 --> F1 --> F2
  F2 --> F3

  classDef done fill:#14532d,stroke:#22c55e,color:#dcfce7
  classDef active fill:#1e3a8a,stroke:#3b82f6,color:#dbeafe
```

### Phase 0 — Data and import ✅

- Document-shaped model validated.
- One-off importer for the existing JSON files.
- 16 jobs, 34 runs, 97 artifacts, 4 profiles, 2 settings.
- 19 initial tests.

### Phase 1 — SQLite and API ✅

- Drizzle + versioned migrations.
- Repositories with contracts.
- REST API (`/api/jobs`, `/api/runs`, `/api/stats`, profiles, settings).
- Compatibility with the old UI (`/api/applications`, `/api/processes`, viewers).
- 103 backend tests; smoke test with real data.

### Phase 2 — React ✅

Goal: replace the old UI with a SPA while keeping the API as the only data source.

**Proposed stack**

| Item | Choice | Reason |
|---|---|---|
| Build | Vite | Fast, native ESM, simple dev proxy |
| Language | TypeScript | Already the backend's standard |
| Data | TanStack Query | Cache, invalidation, loading/error states |
| Routes | React Router | Dashboard, detail, admin |
| Styling | CSS Modules or Tailwind | To be decided at the start of the phase |

**Deliverables**

- [x] Scaffold `web/` with proxy `/api` → `http://localhost:3344`.
- [x] Dashboard: stats + job list with status filters and search.
- [x] Job detail: fit (rating, dimensions, strengths, gaps), runs and artifacts.
- [x] Resume/letter viewing via the backend viewers.
- [x] Component and integration tests (28 tests).
- [x] Workspace scripts (`dev:web`, `build:web`, `test:web`, `typecheck:web`).
- [x] Build served by Express with SPA fallback.
- [x] Admin page: PDF theme and form data.
- [x] App Settings: configurable targets (stack × language), base resume and extra instructions
  per target, with enable/disable and remove.
- [x] Polling of active runs (4 s).
- [x] Filters in the URL and visible pagination (25 per page).

- [x] Interactive checkpoint inside the SPA (question, suggested options, inference approval).
- [x] Discrete pipeline entrypoints (fit-check and kit generation) on the job detail.

### Phase 3 — Pipeline port ✅

Goal: move the heavy v1 pipeline into `src/pipeline/` behind the v2 API, keeping v1 as fallback.

- [x] Kit generation: slug, deterministic suggestions, validators, pure steps and artifact writer.
- [x] PDF with an ATS layer (`page.pdf` + `pdftotext`), cover letter rendering.
- [x] `POST /api/generate-kit` (202) with the 409 gates and `needs_input` replay without LLM.
- [x] Interactive queue: `GET /api/runs/:id/question` and `POST /api/runs/:id/respond` (≤ 2 rounds).
- [x] `POST /api/jobs/:id/regenerate` (202) preserving id/status/dates.
- [x] Base resume upload with `pdftotext` (`POST /api/profiles/:stack/:language/upload`), including
  the control in App Settings.
- [x] Candidate data derived from the base resume.
- [x] Full gate: 285 backend tests, 43 frontend tests, `typecheck`, `typecheck:web` and `build:web`.

**Registered backlog**

- Pre-fill dry-run (`apply_assistant.mjs`) and `scrape_application_questions.mjs` — standalone v1
  scripts, deliberately out of the port.
- Retire the old UI and remove the `/api/applications` + `/api/processes` compatibility routes.

## 2. Technical backlog

| Priority | Item | Impact |
|---|---|---|
| High | React frontend | Replace the old UI |
| High | Aggregate endpoint for listings (eliminates N+1) | Performance |
| Low | Retire the old UI and the compatibility routes | Removes duplicated surface |
| Medium | Authentication and real `owner_id` | Multi-user |
| Medium | Authorization tests | Security |
| Low | Metrics and tracing | Observability |
| Low | Automated backup | Operations |
| Low | CI (typecheck + test + audit) | Quality |

## 3. Phase 2 completion criteria

- [x] Dashboard lists, filters and searches jobs via `/api/jobs`.
- [x] Detail shows fit, runs and artifacts.
- [x] Status can be changed from the UI.
- [x] Resume and extras open in a new tab via the viewers.
- [x] Admin reads/writes theme and form data.
- [x] App Settings manages targets, base resumes and extra instructions.
- [x] No screen depends on `/api/applications`.
- [x] Frontend tests passing (43).
- [ ] The old UI can be retired (pending the upload control and the compatibility-route removal).

## 4. Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Heavy pipeline taking longer than expected | High | Keep the old app running in parallel |
| Data divergence between the old app and v2 | Medium | v2 as single source after Phase 2 |
| LLM cost | Medium | Fit caching and per-user limits |
| Database migration breaking queries | Low | Repository contract tests |
| Scope growing to multi-user | Medium | `owner_id` already prepared; auth when multi-user support arrives |
