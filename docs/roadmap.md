# Roadmap

## 1. Fases

```mermaid
flowchart LR
  F0["Fase 0 - Dados e importação"]:::done
  F1["Fase 1 - SQLite e API"]:::done
  F2["Fase 2 - React"]:::active
  F3["Fase 3 - Nuvem e pipeline"]:::next

  F0 --> F1 --> F2 --> F3

  classDef done fill:#14532d,stroke:#22c55e,color:#dcfce7
  classDef active fill:#1e3a8a,stroke:#3b82f6,color:#dbeafe
  classDef next fill:#3f3f46,stroke:#a1a1aa,color:#f4f4f5
```

### Fase 0 — Dados e importação ✅

- Modelo document-shaped validado.
- Importador one-off dos JSONs do v1.
- 16 vagas, 34 runs, 97 artefatos, 4 perfis, 2 settings.
- 19 testes iniciais.

### Fase 1 — SQLite e API ✅

- Drizzle + migrations versionadas.
- Repositórios com contratos.
- API REST (`/api/jobs`, `/api/runs`, `/api/stats`, profiles, settings).
- Compatibilidade com a UI v1 (`/api/applications`, `/api/processes`, visualizadores).
- 64 testes de backend; smoke test com dados reais.

### Fase 2 — React 🚧

Objetivo: substituir `public/index.html` por uma SPA mantendo a API como única fonte de dados.

**Stack proposta**

| Item | Escolha | Motivo |
|---|---|---|
| Build | Vite | Rápido, ESM nativo, proxy de dev simples |
| Linguagem | TypeScript | Já é o padrão do backend |
| Dados | TanStack Query | Cache, invalidação, estados de loading/erro |
| Rotas | React Router | Dashboard, detalhe, admin |
| Estilo | CSS Modules ou Tailwind | A decidir no início da fase |

**Entregas**

- [x] Scaffold `web/` com proxy `/api` → `http://localhost:3344`.
- [x] Dashboard: stats + lista de vagas com filtros de status e busca.
- [x] Detalhe da vaga: fit (rating, dimensões, forças, gaps), runs e artefatos.
- [x] Visualização de currículo/carta via visualizadores do backend.
- [x] Testes de componente e de integração (17 testes).
- [x] Scripts de workspace (`dev:web`, `build:web`, `test:web`, `typecheck:web`).
- [x] Build servido pelo Express com fallback de SPA.
- [x] Página de admin: perfis base (texto), tema de PDF, dados do formulário.
- [ ] Polling de runs em `processing` e resposta de checkpoint.
- [ ] Filtros na URL e paginação visível.

**Decisões pendentes**

- Estratégia de polling para runs em `processing`.
- Upload de PDF no admin: porta o extrator do v1 ou mantém só texto/arquivos leves.

### Fase 3 — Nuvem e pipeline ⏳

Duas frentes independentes:

**3a. Adaptador de nuvem**

| Opção | Prós | Contras |
|---|---|---|
| Turso/libSQL | SQL compatível, troca quase direta | Menos recursos de consulta |
| Supabase/Postgres | SQL completo, auth e storage integrados | Mais peças para operar |
| Firestore | Serverless, tempo real | Sem joins; exige remodelar consultas |

Recomendação: **Turso** se o objetivo for mínima mudança; **Supabase** se auth/storage forem
necessários; **Firestore** só se Firebase for requisito. Detalhes em
[ADR-0003](./adr/0003-repository-pattern-e-nuvem.md).

**3b. Pipeline pesado**

Portar de `server.mjs` do v1:

- raspagem de vaga (Playwright);
- motor de fit híbrido;
- chamadas de LLM (com chave em secret manager);
- geração de HTML/PDF;
- fila interativa de perguntas (`needs_input`).

Isso exige um runtime com navegador — Cloud Run, Fly.io ou um worker dedicado. Funções serverless
puras não atendem Playwright + Chromium para PDF.

## 2. Backlog técnico

| Prioridade | Item | Impacto |
|---|---|---|
| Alta | Frontend React | Substituir a UI v1 |
| Alta | Endpoint agregado para listagem (elimina N+1) | Performance |
| Média | Portar pipeline de processamento | Paridade funcional |
| Média | Autenticação e `owner_id` real | Nuvem |
| Média | Testes de autorização | Segurança |
| Baixa | Métricas e tracing | Observabilidade |
| Baixa | Backup automatizado | Operação |
| Baixa | CI (typecheck + test + audit) | Qualidade |

## 3. Critérios de conclusão da Fase 2

- [x] Dashboard lista, filtra e busca vagas via `/api/jobs`.
- [x] Detalhe mostra fit, runs e artefatos.
- [x] Status pode ser alterado pela UI.
- [x] Currículo e extras abrem em nova aba via visualizadores.
- [x] Admin lê/escreve perfis, tema e dados do formulário.
- [x] Nenhuma tela depende de `/api/applications`.
- [x] Testes de frontend passando (17).
- [ ] `public/index.html` do v1 pode ser aposentado.

## 4. Riscos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Pipeline pesado demorar mais que o previsto | Alta | Manter v1 rodando em paralelo |
| Divergência de dados entre v1 e v2 | Média | v2 como fonte única após Fase 2 |
| Custo de LLM em nuvem | Média | Cache de fit e limites por usuário |
| Migração de banco quebrar consultas | Baixa | Testes de contrato dos repositórios |
| Escopo crescer para multiusuário | Média | `owner_id` já preparado; auth na Fase 3 |
