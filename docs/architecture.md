# Architecture

## 1. Overview

v2 is a **local-first** application with three blocks:

1. **UI** — today the v1 vanilla page; from Phase 2 on, a React app.
2. **API** — Express 5, owning validation, access rules and format translation.
3. **Persistence** — SQLite for structured data and the filesystem for generated artifacts
   (PDF, HTML, TXT).

v1's heavy pipeline (Playwright, LLM, PDF generation) **has not been ported yet**; it stays on the
old server. v2 is today the source of truth for job, run and artifact data.

## 2. Context

```mermaid
flowchart LR
  USER["User"]
  UI1["v1 UI - vanilla JS on port 3333"]
  UI2["v2 UI - React on port 5173"]
  API["v2 API - Express on port 3344"]
  PIPE["v1 pipeline - Playwright, LLM and PDF"]
  DB[("SQLite - data/job-search.db")]
  FS[("Artifacts - applications/")]
  BASE[("Base profiles - base_profile/")]

  USER --> UI1
  USER --> UI2
  UI1 -->|"/api/applications and /api/processes"| API
  UI2 -->|"/api/jobs, /api/runs and /api/stats"| API
  API --> DB
  API --> FS
  API --> BASE
  PIPE -->|"writes artifacts and checkpoints"| FS
  PIPE -->|"one-off import"| DB
```

## 3. Containers

```mermaid
flowchart TB
  subgraph BROWSER["Browser"]
    V1["v1 UI - vanilla single page"]
    V2["v2 UI - React + Vite"]
  end

  subgraph NODE["Node.js 24"]
    EXPRESS["Express 5 - src/api"]
    META["Metadata routes"]
    COMPAT["v1 compatibility routes"]
    JOBS["REST routes for jobs and runs"]
    REPO["Repositories - src/repositories"]
    DOMAIN["Domain + Zod - src/domain"]
    IMP["v1 importer - src/migrations"]
    MIG["Drizzle migrator - src/db"]
  end

  DB[("SQLite")]
  FILES[("Files on disk")]

  V1 --> COMPAT
  V1 --> META
  V2 --> JOBS
  V2 --> META
  COMPAT --> REPO
  JOBS --> REPO
  META --> REPO
  REPO --> DB
  REPO --> DOMAIN
  IMP --> REPO
  IMP --> FILES
  MIG --> DB
  COMPAT --> FILES
```

### Responsibilities

| Component | Responsibility | Does not do |
|---|---|---|
| `src/api` | HTTP, input validation, status codes, DTOs | SQL, deep business logic |
| `src/domain` | Types, Zod schemas, dates, IDs | Database access |
| `src/repositories` | Contracts and SQLite implementation | HTTP, UI formatting |
| `src/db` | Drizzle schema, connection, migrations | Business logic |
| `src/migrations` | One-off import from v1 | Runtime usage |
| `web/` (Phase 2) | React UI, data cache, navigation | Direct SQLite access |

## 4. Folder structure

```text
job-search-v2/
├── web/                        # React frontend (Vite + TanStack Query)
│   ├── src/
│   │   ├── api/                # client, types and hooks
│   │   ├── components/         # layout, fit, runs, artifacts
│   │   ├── pages/              # dashboard and detail
│   │   └── lib/                # formatting and labels
│   └── dist/                   # build served by Express
├── src/
│   ├── api/
│   │   ├── app.ts              # mounts Express and middlewares
│   │   ├── server.ts           # bootstrap, port, shutdown
│   │   ├── http.ts             # HttpError, parseBody, error handler
│   │   ├── dto/legacy.ts       # translation to the v1 format
│   │   └── routes/
│   │       ├── jobs.ts         # /api/jobs
│   │       ├── runs.ts         # /api/runs
│   │       ├── meta.ts         # profiles, settings, pdf-theme, candidate-data
│   │       ├── compat.ts       # /api/applications and /api/processes
│   │       └── viewers.ts      # /cv/:id and /extras/:id/:view
│   ├── domain/                 # Job, Run, Fit, Artifact, dates, IDs
│   ├── db/                     # schema, SQLite client, migrator
│   ├── repositories/           # interfaces + SQLite implementation
│   └── migrations/from-json.ts # v1 importer
├── drizzle/                    # generated SQL migrations
├── test/                       # Vitest + Supertest
├── data/                       # local SQLite (gitignored)
└── docs/                       # this documentation
```

## 5. Read flow

```mermaid
sequenceDiagram
  autonumber
  participant UI as "UI"
  participant API as "Express"
  participant REPO as "JobRepository"
  participant DB as "SQLite"

  UI->>API: GET /api/jobs?status=applied
  API->>API: validates query with Zod
  API->>REPO: list({ status, limit, offset })
  REPO->>DB: SELECT ... WHERE status = ? ORDER BY applied_at DESC LIMIT ?
  DB-->>REPO: rows
  REPO-->>API: Job[] + total
  API-->>UI: 200 { items, total }
```

## 6. Write flow

```mermaid
sequenceDiagram
  autonumber
  participant UI as "UI"
  participant API as "Express"
  participant REPO as "JobRepository"
  participant DB as "SQLite"

  UI->>API: PATCH /api/jobs/app_123
  API->>API: jobPatchSchema.safeParse(body)
  alt invalid body
    API-->>UI: 400 with issues
  else valid body
    API->>REPO: update(id, patch)
    REPO->>DB: UPDATE jobs SET ... WHERE id = ?
    DB-->>REPO: changes
    REPO-->>API: updated Job or null
    API-->>UI: 200 Job or 404
  end
```

## 7. Import from v1

```mermaid
sequenceDiagram
  autonumber
  participant CLI as "pnpm db:import"
  participant IMP as "from-json.ts"
  participant DB as "SQLite"
  participant FS as "applications/"

  CLI->>IMP: tracker, processes, applications, base_profile
  IMP->>DB: runMigrations()
  IMP->>IMP: checks the database is empty
  IMP->>DB: BEGIN
  loop each job in the tracker
    IMP->>IMP: normalizes date, status and fit
    IMP->>DB: INSERT jobs
    IMP->>FS: stat on referenced artifacts
    IMP->>DB: INSERT artifacts
  end
  loop each process
    IMP->>IMP: resolves applicationId or URL into job_id
    IMP->>DB: INSERT runs
  end
  IMP->>DB: INSERT profiles and settings
  IMP->>DB: COMMIT
  IMP-->>CLI: report with counts and warnings
```

## 8. Compatibility strategy

```mermaid
flowchart LR
  V1UI["v1 UI"]
  NEW["New API - /api/jobs and /api/runs"]
  COMPAT["Compat layer - /api/applications and /api/processes"]
  DTO["dto/legacy.ts"]
  REPO["Repositories"]
  DB[("SQLite")]

  V1UI --> COMPAT
  COMPAT --> DTO
  DTO --> REPO
  NEW --> REPO
  REPO --> DB
```

The old UI doesn't talk to the database: it talks to routes that translate the new domain into the
old DTO. Once React takes over, the compatibility layer can be removed without touching the
repositories.

## 9. Evolution to the cloud

```mermaid
flowchart LR
  CONTRACTS["Interfaces in repositories/types.ts"]
  SQLITE["SQLite - today"]
  TURSO["Turso or libSQL"]
  SUPA["Supabase or Postgres"]
  FIRE["Firestore"]

  CONTRACTS --> SQLITE
  CONTRACTS -.->|"same SQL"| TURSO
  CONTRACTS -.->|"SQL and joins"| SUPA
  CONTRACTS -.->|"documents"| FIRE
```

The current model was designed to make the swap cheap: JSON aggregates, no mandatory joins, stable
IDs and `owner_id` from the start. The details are in
[ADR-0002](./adr/0002-document-shaped-model.md) and
[ADR-0003](./adr/0003-repository-pattern-and-cloud.md).

## 10. Quality attributes

| Attribute | How it is addressed | Current limit |
|---|---|---|
| Simplicity | One Node process, one SQLite file, no infrastructure | Doesn't scale to multiple concurrent users |
| Portability | Repositories + JSON columns + ISO + `owner_id` | The legacy DTO still couples the v1 UI |
| Testability | 64 backend tests + 23 frontend tests; temporary database and Supertest | Heavy pipeline not tested in v2 |
| Security | Zod validation, path traversal blocked, secrets out of the database | No authentication; assumes local use |
| Performance | Indexes on status, date, company and job_id; WAL | No cache; N+1 when listing artifacts per job |
| Observability | Error logs in the global handler; health check | No metrics or tracing |

## 11. Known limits

- v2 **does not run** Playwright, LLM calls or PDF generation.
- There is no authentication; `owner_id` exists but is always `local`.
- The `/api/applications` listing runs one artifact query per job (N+1). For 16 jobs it's
  irrelevant; it will be solved in React with an aggregate endpoint or `IN (...)`.
- The v1 UI still calls processing routes that only exist on the old server.
- React covers dashboard and detail; admin (profiles, theme, form data) has not been migrated yet.
- Dashboard filters are not in the URL.

## 12. Related decisions

- [ADR-0001 — SQLite in the backend](./adr/0001-sqlite-in-backend.md)
- [ADR-0002 — Document-shaped model](./adr/0002-document-shaped-model.md)
- [ADR-0003 — Repositories and cloud](./adr/0003-repository-pattern-and-cloud.md)
- [ADR-0004 — Strangler strategy](./adr/0004-strangler-strategy-v1-compatibility.md)
- [ADR-0005 — Identity, dates and nulls](./adr/0005-identity-datas-and-nulls.md)
- [ADR-0006 — Artifacts on the filesystem](./adr/0006-artifacts-on-the-filesystem.md)
- [ADR-0007 — Zod at the boundary](./adr/0007-zod-at-the-http-boundary.md)
- [ADR-0008 — Vitest and Supertest](./adr/0008-vitest-supertest.md)
