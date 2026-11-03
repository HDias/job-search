# Job Search Assistant v2

Reescrita incremental do app v1 (`../job-search`): **API + SQLite agora, React em seguida, nuvem depois**.
O v1 continua intacto; esta pasta é o novo backend.

## Status

- [x] Fase 0 — modelo de dados, normalização e script de importação dos JSONs
- [x] Fase 1 — SQLite + Drizzle, repositórios, rotas HTTP e compatibilidade com a UI v1
- [x] Testes — 34 testes de repositório, importação, API e compatibilidade
- [ ] Fase 2 — frontend React (Vite + TS + TanStack Query)
- [ ] Fase 3 — adaptador Turso/Supabase/Firestore

## Stack

| Camada | Escolha |
|---|---|
| Runtime | Node.js 24 |
| Banco | SQLite (`better-sqlite3`) + Drizzle ORM |
| Validação | Zod |
| Testes | Vitest |
| Execução TS | `tsx` |

## Comandos

```bash
pnpm install
pnpm dev                 # API em http://localhost:3344
pnpm typecheck
pnpm test
pnpm db:migrate          # aplica as migrations em data/job-search.db
pnpm db:import           # importa os JSONs do v1 (padrão: ../job-search)
pnpm db:import --reset   # limpa e reimporta
```

Opções do import:

```bash
pnpm db:import \
  --tracker ../job-search/job_search_tracker.json \
  --processes ../job-search/job_processes.json \
  --applications ../job-search/applications \
  --base-profile ../job-search/base_profile \
  --db data/job-search.db \
  --reset
```

## Estrutura

```
src/
  api/             Express, rotas REST, compatibilidade v1 e visualizadores
  domain/          tipos + schemas Zod (Job, Run, Fit, Artifact…)
  db/              schema Drizzle, cliente SQLite, migrator
  repositories/    interfaces + implementação SQLite
  migrations/      importador one-off JSON → SQLite
drizzle/           SQL de migração gerado pelo drizzle-kit
test/              repositórios, importação, API e compatibilidade
```

## Modelo de dados

- `jobs` — uma linha por vaga. `fit`, `strengths`, `gaps`, `eligibility` etc. ficam em `fit_json`
  (document-shaped, sem normalização excessiva).
- `runs` — checkpoints de processamento (Playwright/LLM), ligados a `jobs` por `job_id` **nullable**.
  Runs antigos cuja vaga não existe mais continuam válidos com `job_id = null`.
- `artifacts` — metadados de PDFs/HTMLs/TXTs. O arquivo continua no disco; o banco guarda só o
  caminho relativo e o MIME.
- `profiles` — currículos base por `(stack, language)`.
- `settings` — tema de PDF, perfil calculado, dados de formulário. **Chaves de API não são importadas.**

### Decisões que facilitam a ida para a nuvem

- Datas em **ISO 8601** (o v1 usava `dd/mm/yyyy`).
- IDs com prefixo (`app_`, `proc_`, `art_`) e UUID — funcionam como doc IDs no Firestore.
- `owner_id` já existe (default `local`): evita backfill quando entrar autenticação.
- Nada de `undefined`: campos ausentes viram `null`.
- Acesso a dados só via interfaces em `src/repositories/types.ts`. Trocar SQLite por Turso,
  Supabase ou Firestore é implementar outra classe, sem tocar na UI.

## API

REST principal (formato novo):

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | health check |
| GET | `/api/stats` | totais por status, fit médio, aplicações em 30 dias |
| GET | `/api/jobs?status=&q=&limit=&offset=` | lista paginada |
| GET | `/api/jobs/:id` | vaga + runs + artefatos |
| POST/PATCH/DELETE | `/api/jobs` e `/api/jobs/:id` | CRUD |
| GET | `/api/runs?jobId=&stage=` | checkpoints |
| GET/POST/PATCH/DELETE | `/api/runs` e `/api/runs/:id` | CRUD |
| GET/PUT | `/api/profiles/:stack/:language` | currículos base |
| GET/PUT | `/api/settings/:key` | settings genéricos |

Compatibilidade com o `public/index.html` do v1:

- `GET/PUT/DELETE /api/applications[/:id]` — DTO legado (date `dd/mm/yyyy`, `fitRating`,
  `cvPdfFile`, `fitDimensions`, `languageConfirmation`…).
- `GET/PUT/DELETE /api/processes[/:id]` — checkpoints no formato legado (`job`, `jobSnapshot`,
  `applicationId`, fit achatado).
- `GET/PUT /api/base-resumes`, `/api/pdf-theme`, `/api/candidate-data`.
- `/applications/*` (estáticos), `/cv/:id` e `/extras/:id/:view`.
- Rotas de processamento pesado (Playwright/LLM: `/api/process-job`, `/api/fit-check`, etc.)
  continuam no v1 por enquanto.

## Resultado da importação real do v1

```
vagas:     16
processos: 34 (17 sem vaga correspondente)
artefatos: 97
perfis:    4
settings:  2
```

Os 17 runs órfãos são processamentos antigos cujo registro saiu do tracker do v1. Eles foram
preservados com `job_id = null` e o snapshot da vaga.

## Próximos passos

1. Migrar as telas do `public/index.html` para React, uma por vez, atrás da mesma API.
2. Portar o pipeline pesado (Playwright/LLM/PDF) como serviços do v2.
3. Manter os testes de repositório como contrato ao trocar o adaptador de banco.
