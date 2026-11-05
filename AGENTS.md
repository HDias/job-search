# AGENTS.md

Instruções para sessões do OpenCode neste repositório. Documentação completa em
[`docs/`](./docs/README.md); este arquivo cobre só o que costuma ser deduzido errado.

## O que é

Reescrita do app v1 (`../job-search`) em **Express + SQLite + React**. O v1 continua funcional na
porta `3333` e é a referência do pipeline pesado (Playwright/LLM/PDF), que **ainda não foi portado**.
Não remova as rotas de compatibilidade nem o v1: a migração é *strangler*.

- Backend: `src/` (Express 5, Drizzle, Zod, repositórios)
- Frontend: `web/` (Vite 6, React 19, TanStack Query 5, React Router 7)
- Persistência: SQLite em `data/job-search.db` (gitignored), acessado **só pelo backend**

## Comandos

```bash
pnpm dev            # API 3344 (watch)
pnpm dev:web        # React 5173 (proxy /api → 3344)
pnpm start          # API + SPA buildada em 3344
pnpm build:web      # build do React em web/dist
pnpm typecheck      # backend
pnpm typecheck:web  # frontend
pnpm test           # backend (Vitest, Node)
pnpm test:web       # frontend (Vitest, jsdom)
```

Verificação antes de concluir qualquer mudança:

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # se mexeu em web/
pnpm build:web                        # se mudou algo que afeta o build
```

Teste único:

```bash
pnpm test -- test/requests.test.ts
pnpm test -- -t "stats"
pnpm test:web -- Dashboard
```

Não há lint, formatter, CI nem pre-commit configurados. Os comandos acima são o gate.

## Quirks do toolchain

- **ESM + `module: NodeNext`**: todo import relativo de TypeScript precisa de extensão `.js`
  (`import { createApp } from './app.js'`), inclusive em `src/` e `test/`.
- **pnpm 11** ignora o campo `pnpm` do `package.json`. Permissões de build nativo ficam em
  `pnpm-workspace.yaml` (`allowBuilds`); sem isso `better-sqlite3` falha.
- **Dois Vitest**: `vitest.config.ts` da raiz inclui só `test/**/*.test.ts`. Testes do frontend
  rodam por `web/vite.config.ts` com jsdom. Não adicione testes de `web/` ao config da raiz.
- O backend roda migrations no boot; `pnpm db:migrate` é opcional fora de CI/import.

## Banco e migrations

- Schema em `src/db/schema.ts`. Depois de editar:
  `pnpm exec drizzle-kit generate --name=...`. **Nunca edite SQL já aplicado** em `drizzle/`.
- Colunas de documento (`fit_json`, `job_json`, `job_snapshot`) existem para facilitar a futura
  migração para Firestore/Turso. Mantenha o padrão *document-shaped*.
- Persistência é acessada apenas via `src/repositories/types.ts`. Código novo não deve importar
  Drizzle direto; adicione método à interface e implemente em `src/repositories/sqlite/`.
- Import do v1: `pnpm db:import --reset` (exige banco vazio sem `--reset`).

## Caminhos e portas

- Defaults apontam para o v1: `APPLICATIONS_DIR=../job-search/applications`,
  `BASE_PROFILE_DIR=../job-search/base_profile`. **Não copie** esses arquivos para este repo.
- Portas: API v2 `3344`, Vite `5173`, v1 `3333`. `WEB_DIST` troca o diretório do build.
- Artefatos ficam no disco; o banco guarda caminho relativo + metadados.

## API

- Rotas novas: `/api/jobs`, `/api/runs`, `/api/stats`, `/api/profiles`, `/api/settings`.
- `/api/applications` e `/api/processes` são **DTOs legados** para a UI v1. Não construa features
  novas sobre eles.
- O SPA fallback em `src/api/app.ts` exclui `/api`, `/applications`, `/base_profile`, `/cv` e
  `/extras`; um artefato ausente deve continuar `404`, não virar HTML.
- Visualizadores: `/cv/:id` e `/extras/:id/:view`. `404` com página amigável quando o arquivo sumiu.

## Convenções

- Docs, mensagens de erro e UI em **pt-BR**; identificadores de código em inglês.
- Commits no estilo conventional com descrição em português (ex.:
  `feat(web): dashboard e detalhe da vaga em React`).
- Não introduza biblioteca de UI, Redux/Zustand nem `dangerouslySetInnerHTML` sem necessidade
  explícita; o padrão atual é CSS próprio + cache do TanStack Query.
- Ao mudar um campo do domínio, atualize os dois lados: `src/domain/` e `web/src/api/types.ts`.

## Pendências conhecidas

- Pipeline pesado (`/api/process-job`, `/api/fit-check`, upload/regenerate, checkpoints
  interativos) existe **só no v1**.
- Fase 2 incompleta: polling de runs em `processing` e filtros na URL.
- Admin edita currículo como texto (`.txt`/`.md`/`.html` ou colado); extração de PDF ainda depende
  do v1. Não há upload de PDF no v2.
