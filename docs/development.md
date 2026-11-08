# Development

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.13.0 | Defined in `.tool-versions` |
| pnpm | 11.3.0 | `packageManager` is not honored; see section 3 |
| Python 3 | optional | Only if you want to redo the bulk adjustments made during the migration |

If you use `asdf`:

```bash
asdf install
```

## 2. Installation

```bash
git clone <repo>
cd job-search-v2
pnpm install
# Playwright browser used by the scraping step (not downloaded by pnpm install):
pnpm exec playwright install chromium
```

On first install, pnpm compiles `better-sqlite3` and `esbuild` from source. This is allowed in
`pnpm-workspace.yaml`:

```yaml
packages:
  - web

allowBuilds:
  better-sqlite3: true
  esbuild: true
```

Without this block, `better-sqlite3` fails with a native binary error. `packages` registers `web/`
as a workspace package.

## 3. pnpm 11

pnpm 11 no longer reads the `pnpm` field in `package.json`. Build settings live in
`pnpm-workspace.yaml`. If you add a dependency that needs an install script, declare it in
`allowBuilds`.

## 4. Database

The database lives at `data/job-search.db` (gitignored). To create it from scratch:

```bash
pnpm db:migrate
```

The API also runs migrations on boot (`runMigrations(store.db)` in `src/api/server.ts`), so
`pnpm dev` already leaves the database ready. Running `db:migrate` explicitly is useful in CI and
before importing.

### Import legacy data

```bash
pnpm db:import -- --tracker <legacy-dir>   # <legacy-dir> = the legacy project directory
pnpm db:import -- --reset        # wipe and re-import
```

Details in [migration-v1-v2.md](./migration-v1-v2.md).

## 5. Environment variables

Copy `.env.example` to `.env` if you want to override the defaults. The project does **not** load
`.env` automatically; export the variables or use `dotenv` in your shell.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3344` | API port |
| `DB_FILE` | `./data/job-search.db` | SQLite path |
| `APPLICATIONS_DIR` | `<legacy-dir>/applications` | Generated artifacts |
| `BASE_PROFILE_DIR` | `<legacy-dir>/base_profile` | Base profiles |
| `WEB_DIST` | `./web/dist` | React build served by Express |

`<legacy-dir>` is the legacy project directory. Defaults are resolved with `path.resolve` from the
project root (`src/config.ts`).

## 6. Commands

```bash
pnpm dev            # API with watch on http://localhost:3344
pnpm start          # API without watch (serves web/dist if it exists)
pnpm dev:web        # Vite on http://localhost:5173
pnpm build:web      # production build in web/dist
pnpm typecheck      # backend: tsc --noEmit
pnpm typecheck:web  # frontend: tsc --noEmit
pnpm test           # backend: Vitest (Node environment)
pnpm test:web       # frontend: Vitest (jsdom)
pnpm db:migrate     # apply migrations
pnpm db:import      # import legacy data
```

### Running the frontend

In development, two terminals:

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm dev:web
```

Vite proxies `/api`, `/applications`, `/base_profile`, `/cv` and `/extras` to the API on `3344`.
No CORS configuration is needed.

In production:

```bash
pnpm build:web
pnpm start
```

Everything ends up at `http://localhost:3344`: API, artifacts and SPA. Details in
[frontend.md](./frontend.md).

## 7. Running alongside the legacy app

The legacy app uses port `3333` and v2 uses `3344`. Both can run at the same time: start the legacy
app from its own project directory and v2 from this repository.

```bash
# terminal 1 — legacy app, from its own project
pnpm start

# terminal 2 — v2, from this repository
pnpm dev
```

v2 resolves `APPLICATIONS_DIR` and `BASE_PROFILE_DIR` to the legacy directories by default, so the
artifacts show up in the viewers without copying. **Don't point both at the same database** — the
legacy app doesn't know the new schema.

## 8. Development flow

1. Change the domain in `src/domain/` (types + Zod schema).
2. If the schema changed, adjust `src/db/schema.ts` and run `pnpm drizzle-kit generate`.
3. Adjust/add the repository in `src/repositories/sqlite/`.
4. Expose it in the route under `src/api/routes/`.
5. Cover it with a test in `test/`.
6. `pnpm typecheck && pnpm test`.
7. If the UI changed, run `pnpm typecheck:web && pnpm test:web`.
8. Update the docs and, if it's a structural decision, write an ADR.

### Changing the frontend

- Pages in `web/src/pages/`, components in `web/src/components/`.
- API calls in `web/src/api/client.ts`; hooks in `web/src/api/hooks.ts`.
- Types mirror `src/domain/` in `web/src/api/types.ts`. When you change a field in the backend,
  update both sides.
- Single stylesheet in `web/src/styles.css`.
- Tests next to the code (`*.test.tsx`).

### Creating a migration

```bash
pnpm drizzle-kit generate --name=my_change
```

The SQL goes to `drizzle/000N_my_change.sql` and the snapshot to `drizzle/meta/`. **Never edit an
already-applied migration**; create another one.

Destructive migrations in SQLite (drop/rename of a column) require recreating the table.
`drizzle-kit` generates the SQL, but review it before applying.

### Adding a route

```ts
// src/api/routes/exemplo.ts
import { Router } from 'express';
import type { Store } from '../../repositories/types.js';
import { HttpError } from '../http.js';

export function createExemploRouter(store: Store): Router {
  const router = Router();

  router.get('/:id', (req, res) => {
    const item = store.jobs.get(req.params.id);
    if (!item) throw new HttpError(404, 'Não encontrado');
    res.json(item);
  });

  return router;
}
```

Register it in `src/api/app.ts` **before** `notFoundHandler`. Errors thrown as `HttpError` are
converted by the central `errorHandler`.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Could not locate the bindings file` | `better-sqlite3` didn't compile | `pnpm rebuild better-sqlite3`; check `allowBuilds` |
| `SQLITE_BUSY` | Two processes writing | Use one process per database; WAL helps but doesn't eliminate it |
| `banco já contém dados` on import | Import without `--reset` | `pnpm db:import -- --reset` |
| Artifact 404 | Wrong path in `APPLICATIONS_DIR` | Check the variable and the `relativePath` in the database |
| `status inválido` | Enum different from the domain | See the list in [data-model.md](./data-model.md) |
| Port in use | The legacy app or an old instance | `lsof -i :3344` or `lsof -i :5173` |
| SPA returns 404 in production | `web/dist` doesn't exist | `pnpm build:web` |

## 10. Style

- TypeScript ESM (`"type": "module"`), imports with a `.js` extension.
- No lint framework configured; `tsc --noEmit` is the gate.
- Comments and error messages in Portuguese, code in English.
- Small functions; business logic in the domain, not in the route.
