# Testes

## 1. Visão geral

Backend (raiz):

```text
Test Files  4 passed (4)
Tests      64 passed (64)
```

Frontend (`web/`):

```text
Test Files  3 passed (3)
Tests      23 passed (23)
```

| Arquivo | Testes | Cobre |
|---|---:|---|
| `test/repositories.test.ts` | 13 | Contrato dos repositórios, CRUD, filtros, stats, cascatas |
| `test/from-json.test.ts` | 6 | Importador, normalização de datas/status/fit, campos legados |
| `test/api.test.ts` | 15 | Rotas REST, compatibilidade v1, visualizadores, erros |
| `test/requests.test.ts` | 30 | Todas as rotas HTTP, paginação, validação, 404, transporte e SPA |

Runner: **Vitest 4**. HTTP: **Supertest 7**. Cada teste usa um banco SQLite temporário próprio.

## 2. Como rodar

```bash
pnpm test            # backend (Vitest, ambiente Node)
pnpm test:watch      # backend em watch
pnpm test:web        # frontend (Vitest, ambiente jsdom)
pnpm typecheck
pnpm typecheck:web
```

Filtros:

```bash
pnpm test -- api
pnpm test -- -t "stats"
pnpm test:web -- Dashboard
```

Não é preciso subir a API nem popular o banco real: os testes de backend criam SQLite temporário e
os de frontend mockam `fetch`.

## 3. Isolamento

`test/helpers.ts` expõe `createTestStore()`:

```ts
const ctx = createTestStore();
// ctx.store  → Store com repositórios
// ctx.dir    → diretório temporário (artefatos, perfis)
// ctx.cleanup() → fecha o banco e remove o diretório
```

Cada `beforeEach` cria um store novo; cada `afterEach` chama `cleanup()`. Isso permite rodar em
paralelo sem colisão de arquivo.

## 4. O que os testes garantem

### Repositórios (`repositories.test.ts`)

- Criação de job com defaults corretos (`stack: ruby`, `status: drafted`,
  `languageConfirmation: null`).
- `list` com filtro de status, busca textual e paginação.
- `update` parcial preserva campos não enviados.
- `delete` remove o job e cascateia artefatos; runs ficam com `job_id = NULL`.
- `stats` conta por status, média de fit e últimos 30 dias.
- Runs guardam `stack`, `job` e `jobSnapshot` completo (`content`, `extraQuestions`,
  `recruiterMessage`).
- Profiles e settings fazem upsert e leitura.
- Índice único de artefatos evita duplicata em `(jobId, kind, relativePath)`.

### Importação (`from-json.test.ts`)

- `28/10/2026` vira ISO 8601 UTC.
- Status legado (`encerrado`, `aplicado`…) vira enum novo.
- Fit achatado vira objeto `Fit`.
- `languageConfirmation` é preservado.
- Snapshot completo do run é importado, não só título/empresa.
- Datas inválidas viram `null` com aviso, sem quebrar a importação.

### API (`api.test.ts`)

- `GET /api/health` e `/api/stats`.
- `GET /api/jobs` com filtro válido; `400` para status inválido.
- `GET /api/jobs/:id` devolve job + runs + artefatos; `404` quando não existe.
- CRUD completo de jobs, incluindo body inválido → `400`.
- `PATCH /api/runs/:id` preserva o snapshot.
- `GET /api/applications` no DTO legado: data `dd/mm/yyyy`, `fitRating`, `fitDimensions`,
  caminhos de arquivo e fallback LinkedIn ↔ recrutador.
- `PUT /api/applications/:id` converte status legado e faz merge do fit sem apagar o resto.
- `GET /api/processes` esconde runs `done`.
- `PUT /api/processes/:id` desvincula vaga (`applicationId: null`).
- `DELETE` de applications e processes.
- PDF estático e `/cv/:id` com barra de download.
- `/extras/:id/:view` para e-mail, recrutador e visão inválida.
- `base-resumes`, `pdf-theme` (incluindo cor inválida → `400`), `candidate-data`.
- Profiles, settings genéricos e `404` de rota desconhecida.

### Requests (`requests.test.ts`)

Suíte dedicada a exercitar **cada rota HTTP** e os casos de borda que a UI vai encontrar:

- Lista vazia e `stats` zerados em banco novo.
- Busca textual, filtro por status, paginação e `limit` inválido.
- Criação mínima com defaults (`ownerId`, `language`, `stack`, `status`, `appliedEmails`).
- Datas fora do ISO e campos vazios → `400`.
- CRUD de runs (criar, atualizar, remover) e filtros `jobId`/`stage`.
- `base-resumes` sem perfis; `pdf-theme` com merge parcial; `candidate-data` parcial.
- Upsert de perfis e settings, incluindo corpo sem `value` → `400`.
- Compatibilidade v1: listas vazias, campos de artefato, status desconhecido ignorado,
  desvinculação de run e `404` em recursos ausentes.
- Visualizadores: CV sem arquivo → `404` com página amigável, extras em texto/JSON escapado,
  material ausente → `200` com aviso.
- **Transporte**: JSON malformado → `400`, corpo acima de 4 MB → `413`, path traversal bloqueado,
  formulário sem campos obrigatórios → `400`, rota desconhecida → `404`.

### Frontend (`web/src/**/*.test.tsx`)

| Arquivo | Testes | Cobre |
|---|---:|---|
| `web/src/lib/format.test.ts` | 5 | Datas, fit, bytes, labels e URL de artefatos |
| `web/src/lib/runs.test.ts` | 4 | Run ativo, confirmação pendente e prioridade idioma/fit |
| `web/src/pages/Dashboard.test.tsx` | 7 | Stats, tabela, filtros, URL, paginação, vazio e erro |
| `web/src/pages/JobDetail.test.tsx` | 3 | Fit, runs, artefatos, PATCH de status e 404 |
| `web/src/pages/Admin.test.tsx` | 4 | Currículos base, tema do PDF e dados do formulário |

O `fetch` é mockado com respostas no formato da API. Os testes usam `MemoryRouter` e um
`QueryClient` sem retry. O polling de 4 s não é exercitado com timers: a regra de “run ativo” é
testada isoladamente em `runs.test.ts`.

## 5. O que não está testado

| Área | Risco | Motivo |
|---|---|---|
| Pipeline Playwright/LLM/PDF | Alto | Não foi portado |
| Autenticação | Alto quando houver nuvem | Não existe hoje |
| Concorrência de escrita | Médio | Uso local single-user |
| Migração de banco real | Médio | Smoke test manual, não automatizado |
| Resposta de checkpoint no v2 | Médio | Depende do pipeline portado |
| Upload de currículo em PDF | Médio | Extração ainda depende do v1 |
| Performance com volume | Baixo hoje | 16 vagas; N+1 tolerado |

## 6. Adicionando testes

### Repositório

```ts
it('filtra por status', () => {
  const { store } = createTestStore();
  store.jobs.create({ company: 'Acme', role: 'Dev', status: 'applied' });
  const page = store.jobs.list({ status: 'applied' });
  expect(page.total).toBe(1);
});
```

### Rota

```ts
it('responde 404 para vaga inexistente', async () => {
  const app = createApp({ store: ctx.store });
  const res = await request(app).get('/api/jobs/app_x');
  expect(res.status).toBe(404);
});
```

Prefira testar pela **borda HTTP** quando o comportamento envolve validação ou DTO; teste o
repositório diretamente quando o alvo é SQL/filtro/cascata.

## 7. Contrato para a nuvem

Os testes de repositório são o contrato que qualquer adaptador futuro (Turso, Supabase, Firestore)
precisa satisfazer. A ideia é rodar a mesma suíte contra o adaptador novo antes de trocar o default
em produção. Ver [ADR-0003](./adr/0003-repository-pattern-e-nuvem.md).
