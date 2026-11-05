# Arquitetura

## 1. Visão geral

O v2 é uma aplicação **local-first** com três blocos:

1. **UI** — hoje a página vanilla do v1; a partir da Fase 2, um app React.
2. **API** — Express 5, dona da validação, regras de acesso e tradução de formatos.
3. **Persistência** — SQLite para dados estruturados e filesystem para artefatos gerados
   (PDF, HTML, TXT).

O pipeline pesado do v1 (Playwright, LLM, geração de PDF) **ainda não foi portado**; ele continua
no servidor antigo. O v2 hoje é a fonte de verdade dos dados de vagas, runs e artefatos.

## 2. Contexto

```mermaid
flowchart LR
  USER["Usuário"]
  UI1["UI v1 - vanilla JS na porta 3333"]
  UI2["UI v2 - React na porta 5173"]
  API["API v2 - Express na porta 3344"]
  PIPE["Pipeline v1 - Playwright, LLM e PDF"]
  DB[("SQLite - data/job-search.db")]
  FS[("Artefatos - applications/")]
  BASE[("Perfis base - base_profile/")]

  USER --> UI1
  USER --> UI2
  UI1 -->|"/api/applications e /api/processes"| API
  UI2 -->|"/api/jobs, /api/runs e /api/stats"| API
  API --> DB
  API --> FS
  API --> BASE
  PIPE -->|"grava artefatos e checkpoints"| FS
  PIPE -->|"importação one-off"| DB
```

## 3. Containers

```mermaid
flowchart TB
  subgraph BROWSER["Navegador"]
    V1["UI v1 - public/index.html"]
    V2["UI v2 - React + Vite"]
  end

  subgraph NODE["Node.js 24"]
    EXPRESS["Express 5 - src/api"]
    META["Rotas de metadados"]
    COMPAT["Rotas de compatibilidade v1"]
    JOBS["Rotas REST de jobs e runs"]
    REPO["Repositórios - src/repositories"]
    DOMAIN["Domínio + Zod - src/domain"]
    IMP["Importador v1 - src/migrations"]
    MIG["Migrator Drizzle - src/db"]
  end

  DB[("SQLite")]
  FILES[("Arquivos no disco")]

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

### Responsabilidades

| Componente | Responsabilidade | Não faz |
|---|---|---|
| `src/api` | HTTP, validação de entrada, status codes, DTOs | SQL, regra de negócio profunda |
| `src/domain` | Tipos, schemas Zod, datas, IDs | Acesso a banco |
| `src/repositories` | Contratos e implementação SQLite | HTTP, formatação de UI |
| `src/db` | Schema Drizzle, conexão, migrations | Regra de negócio |
| `src/migrations` | Importação one-off do v1 | Uso em runtime |
| `web/` (Fase 2) | UI React, cache de dados, navegação | Acesso direto ao SQLite |

## 4. Estrutura de pastas

```text
job-search-v2/
├── src/
│   ├── api/
│   │   ├── app.ts              # monta Express e middlewares
│   │   ├── server.ts           # bootstrap, porta, shutdown
│   │   ├── http.ts             # HttpError, parseBody, error handler
│   │   ├── dto/legacy.ts       # tradução para o formato do v1
│   │   └── routes/
│   │       ├── jobs.ts         # /api/jobs
│   │       ├── runs.ts         # /api/runs
│   │       ├── meta.ts         # perfis, settings, pdf-theme, candidate-data
│   │       ├── compat.ts       # /api/applications e /api/processes
│   │       └── viewers.ts      # /cv/:id e /extras/:id/:view
│   ├── domain/                 # Job, Run, Fit, Artifact, datas, IDs
│   ├── db/                     # schema, client SQLite, migrator
│   ├── repositories/           # interfaces + implementação SQLite
│   └── migrations/from-json.ts # importador do v1
├── drizzle/                    # migrations SQL geradas
├── test/                       # Vitest + Supertest
├── data/                       # SQLite local (gitignored)
└── docs/                       # esta documentação
```

## 5. Fluxo de leitura

```mermaid
sequenceDiagram
  autonumber
  participant UI as "UI"
  participant API as "Express"
  participant REPO as "JobRepository"
  participant DB as "SQLite"

  UI->>API: GET /api/jobs?status=applied
  API->>API: valida query com Zod
  API->>REPO: list({ status, limit, offset })
  REPO->>DB: SELECT ... WHERE status = ? ORDER BY applied_at DESC LIMIT ?
  DB-->>REPO: linhas
  REPO-->>API: Job[] + total
  API-->>UI: 200 { items, total }
```

## 6. Fluxo de escrita

```mermaid
sequenceDiagram
  autonumber
  participant UI as "UI"
  participant API as "Express"
  participant REPO as "JobRepository"
  participant DB as "SQLite"

  UI->>API: PATCH /api/jobs/app_123
  API->>API: jobPatchSchema.safeParse(body)
  alt body inválido
    API-->>UI: 400 com issues
  else body válido
    API->>REPO: update(id, patch)
    REPO->>DB: UPDATE jobs SET ... WHERE id = ?
    DB-->>REPO: changes
    REPO-->>API: Job atualizado ou null
    API-->>UI: 200 Job ou 404
  end
```

## 7. Importação do v1

```mermaid
sequenceDiagram
  autonumber
  participant CLI as "pnpm db:import"
  participant IMP as "from-json.ts"
  participant DB as "SQLite"
  participant FS as "applications/"

  CLI->>IMP: tracker, processes, applications, base_profile
  IMP->>DB: runMigrations()
  IMP->>IMP: valida se o banco está vazio
  IMP->>DB: BEGIN
  loop cada vaga do tracker
    IMP->>IMP: normaliza data, status e fit
    IMP->>DB: INSERT jobs
    IMP->>FS: stat dos artefatos referenciados
    IMP->>DB: INSERT artifacts
  end
  loop cada processo
    IMP->>IMP: resolve applicationId ou URL para job_id
    IMP->>DB: INSERT runs
  end
  IMP->>DB: INSERT profiles e settings
  IMP->>DB: COMMIT
  IMP-->>CLI: relatório com contagens e avisos
```

## 8. Estratégia de compatibilidade

```mermaid
flowchart LR
  V1UI["UI v1"]
  NEW["API nova - /api/jobs e /api/runs"]
  COMPAT["Camada compat - /api/applications e /api/processes"]
  DTO["dto/legacy.ts"]
  REPO["Repositórios"]
  DB[("SQLite")]

  V1UI --> COMPAT
  COMPAT --> DTO
  DTO --> REPO
  NEW --> REPO
  REPO --> DB
```

A UI antiga não fala com o banco: ela fala com rotas que traduzem o domínio novo para o DTO antigo.
Quando o React assumir, a camada de compatibilidade pode ser removida sem tocar nos repositórios.

## 9. Evolução para nuvem

```mermaid
flowchart LR
  CONTRACTS["Interfaces em repositories/types.ts"]
  SQLITE["SQLite - hoje"]
  TURSO["Turso ou libSQL"]
  SUPA["Supabase ou Postgres"]
  FIRE["Firestore"]

  CONTRACTS --> SQLITE
  CONTRACTS -.->|"mesmo SQL"| TURSO
  CONTRACTS -.->|"SQL e joins"| SUPA
  CONTRACTS -.->|"documentos"| FIRE
```

O modelo atual foi desenhado para tornar a troca barata: agregados em JSON, sem joins obrigatórios,
IDs estáveis e `owner_id` desde o início. Os detalhes estão no
[ADR-0002](./adr/0002-modelo-document-shaped.md) e no
[ADR-0003](./adr/0003-repository-pattern-e-nuvem.md).

## 10. Atributos de qualidade

| Atributo | Como é endereçado | Limite atual |
|---|---|---|
| Simplicidade | Um processo Node, um arquivo SQLite, sem infraestrutura | Não escala para múltiplos usuários simultâneos |
| Portabilidade | Repositórios + JSON columns + ISO + `owner_id` | DTO legado ainda acopla a UI v1 |
| Testabilidade | 63 testes, banco temporário por teste, Supertest | Pipeline pesado não testado no v2 |
| Segurança | Validação Zod, path traversal bloqueado, segredos fora do banco | Sem autenticação; assume uso local |
| Performance | Índices em status, data, empresa e job_id; WAL | Sem cache; N+1 na listagem de artefatos por vaga |
| Observabilidade | Logs de erro no handler global; health check | Sem métricas ou tracing |

## 11. Limites conhecidos

- O v2 **não executa** Playwright, chamadas de LLM nem geração de PDF.
- Não há autenticação; `owner_id` existe, mas é sempre `local`.
- A listagem de `/api/applications` faz uma consulta de artefatos por vaga (N+1). Para 16 vagas é
  irrelevante; será resolvido no React com um endpoint agregado ou `IN (...)`.
- A UI v1 ainda chama rotas de processamento que só existem no servidor antigo.

## 12. Decisões relacionadas

- [ADR-0001 — SQLite no backend](./adr/0001-sqlite-no-backend.md)
- [ADR-0002 — Modelo document-shaped](./adr/0002-modelo-document-shaped.md)
- [ADR-0003 — Repositórios e nuvem](./adr/0003-repository-pattern-e-nuvem.md)
- [ADR-0004 — Estratégia strangler](./adr/0004-estrategia-strangler-compatibilidade-v1.md)
- [ADR-0005 — Identidade, datas e nulos](./adr/0005-identidade-datas-e-nulos.md)
- [ADR-0006 — Artefatos no filesystem](./adr/0006-artefatos-no-filesystem.md)
- [ADR-0007 — Zod na borda](./adr/0007-zod-na-borda.md)
- [ADR-0008 — Vitest e Supertest](./adr/0008-vitest-supertest.md)
