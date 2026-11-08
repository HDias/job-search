# Roadmap

## 1. Phases

```mermaid
flowchart LR
  F0["Phase 0 - Data and import"]:::done
  F1["Phase 1 - SQLite and API"]:::done
  F2["Phase 2 - React"]:::active

  F0 --> F1 --> F2

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

### Phase 2 — React 🚧

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
- [x] Polling of active runs (4 s). Checkpoint response still depends on the pipeline.
- [x] Filters in the URL and visible pagination (25 per page).

**Pending decisions**

- Checkpoint response in v2: requires porting the pipeline's interactive queue.
- PDF upload in admin: port the existing extractor or keep only text/light files.

## 2. Technical backlog

| Priority | Item | Impact |
|---|---|---|
| High | React frontend | Replace the old UI |
| High | Aggregate endpoint for listings (eliminates N+1) | Performance |
| Medium | Port the processing pipeline | Feature parity |
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
- [x] Frontend tests passing (28).
- [ ] The old UI can be retired.

## 4. Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Heavy pipeline taking longer than expected | High | Keep the old app running in parallel |
| Data divergence between the old app and v2 | Medium | v2 as single source after Phase 2 |
| LLM cost | Medium | Fit caching and per-user limits |
| Database migration breaking queries | Low | Repository contract tests |
| Scope growing to multi-user | Medium | `owner_id` already prepared; auth when multi-user support arrives |
