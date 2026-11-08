# AGENTS.md

Instructions for OpenCode sessions in this repository. Full documentation lives in
[`docs/`](./docs/README.md). This file holds only the rules for developing in this repo;
historical and migration context belongs in `.plans/` and the docs.

## What this is

A local-first job application assistant: **Express + SQLite + React**.

- Backend: `src/` (Express 5, Drizzle, Zod, repositories)
- Frontend: `web/` (Vite 6, React 19, TanStack Query 5, React Router 7)
- Persistence: SQLite at `data/job-search.db` (gitignored), accessed **by the backend only**

## Commands

```bash
pnpm dev            # API 3344 (watch)
pnpm dev:web        # React 5173 (proxy /api → 3344)
pnpm start          # API + built SPA on 3344
pnpm build:web      # React build into web/dist
pnpm typecheck      # backend
pnpm typecheck:web  # frontend
pnpm test           # backend (Vitest, Node)
pnpm test:web       # frontend (Vitest, jsdom)
```

Verification before finishing any change:

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # if you touched web/
pnpm build:web                        # if you changed something that affects the build
```

Single test:

```bash
pnpm test -- test/requests.test.ts
pnpm test -- -t "stats"
pnpm test:web -- Dashboard
```

There is no lint, formatter, CI or pre-commit configured. The commands above are the gate.

## Toolchain quirks

- **ESM + `module: NodeNext`**: every relative TypeScript import needs the `.js` extension
  (`import { createApp } from './app.js'`), in `src/` and `test/` alike.
- **pnpm 11** ignores the `pnpm` field in `package.json`. Native build permissions live in
  `pnpm-workspace.yaml` (`allowBuilds`); without this, `better-sqlite3` fails.
- **Two Vitests**: the root `vitest.config.ts` only includes `test/**/*.test.ts`. Frontend tests
  run via `web/vite.config.ts` with jsdom. Don't add `web/` tests to the root config.
- The backend runs migrations on boot; `pnpm db:migrate` is optional outside CI/imports.

## Database and migrations

- Schema in `src/db/schema.ts`. After editing it:
  `pnpm exec drizzle-kit generate --name=...`. **Never edit already-applied SQL** in `drizzle/`.
- Document columns (`fit_json`, `job_json`, `job_snapshot`) exist so the storage engine can be
  swapped later. Keep the *document-shaped* pattern.
- Persistence is accessed only through `src/repositories/types.ts`. New code must not import
  Drizzle directly; add a method to the interface and implement it in `src/repositories/sqlite/`.
- Bulk JSON import: `pnpm db:import --reset` (requires an empty database without `--reset`).

## Paths and ports

- Generated artifacts and base resumes live **outside** the repo, resolved from
  `APPLICATIONS_DIR` and `BASE_PROFILE_DIR` (defaults in `src/config.ts`). **Do not copy** those
  files into this repo.
- Ports: API `3344`, Vite `5173`. `WEB_DIST` changes the build directory.
- Artifacts live on disk; the database stores the relative path plus metadata.

## API

- App routes: `/api/jobs`, `/api/runs`, `/api/stats`, `/api/profiles`, `/api/settings`.
- `/api/applications` and `/api/processes` are **compatibility DTOs** with an external consumer:
  do not remove them, and don't build new features on top of them.
- The SPA fallback in `src/api/app.ts` excludes `/api`, `/applications`, `/base_profile`, `/cv` and
  `/extras`; a missing artifact must stay `404`, not turn into HTML.
- Viewers: `/cv/:id` and `/extras/:id/:view`. `404` with a friendly page when the file is gone.

## Frontend

- `useJob` polls every 4 s while a run is active; dashboard filters/page live in the URL — keep
  them there when adding views.
- Resume editing is text-based (`.txt`/`.md`/`.html` or pasted). There is no PDF upload or
  extraction in this app.

## Conventions

- **Write all code comments, docs, commit messages and test descriptions in English** — never in
  Portuguese, even when the surrounding code or the conversation is in Portuguese.
- Don't introduce a UI library, Redux/Zustand or `dangerouslySetInnerHTML` without an explicit
  need; the current standard is own CSS + TanStack Query caching.
- When changing a domain field, update both sides: `src/domain/` and `web/src/api/types.ts`.
