# Frontend (React)

## 1. Stack

| Item | Escolha | Papel |
|---|---|---|
| Build | Vite 6 | Dev server, proxy e build de produção |
| UI | React 19 | Componentes e estado local |
| Rotas | React Router 7 | Dashboard e detalhe da vaga |
| Dados | TanStack Query 5 | Cache, loading/erro, invalidação |
| Tipos | TypeScript 5.9 | Contrato com a API |
| Testes | Vitest 4 + Testing Library | Componentes e fluxo de dados |

O app fica em `web/` e é um pacote do workspace pnpm.

## 2. Estrutura

```text
web/
├── index.html
├── vite.config.ts          # proxy /api e configuração do Vitest
├── src/
│   ├── main.tsx            # QueryClient + BrowserRouter
│   ├── App.tsx             # rotas
│   ├── styles.css          # tema escuro, layout e componentes
│   ├── api/
│   │   ├── types.ts        # espelho dos tipos do domínio
│   │   ├── client.ts       # fetch + ApiError + query string
│   │   └── hooks.ts        # useStats, useJobs, useJob, useUpdateJob
│   ├── components/         # Layout, badges, fit, runs, artefatos, estados
│   ├── lib/format.ts       # datas, fit, bytes, labels e URLs
│   ├── pages/              # Dashboard, JobDetail, NotFound
│   └── test/               # setup e renderWithProviders
└── dist/                   # build (gitignored)
```

## 3. Rotas

| Rota | Página | Fonte |
|---|---|---|
| `/` | Dashboard | `GET /api/stats` + `GET /api/jobs` |
| `/jobs/:id` | Detalhe da vaga | `GET /api/jobs/:id` |
| `*` | Não encontrado | — |

Filtros do dashboard (`q`, `status`) são estado local por enquanto. A URL ainda não os reflete;
isso entra quando houver necessidade de compartilhar links filtrados.

## 4. Fluxo de dados

```mermaid
flowchart LR
  PAGE["Página React"] --> HOOK["Hook TanStack Query"]
  HOOK --> CLIENT["api/client.ts"]
  CLIENT -->|"fetch /api/*"| API["Express v2"]
  HOOK --> CACHE[("Query cache")]
  CACHE --> PAGE
```

- `useStats` → chave `['stats']`
- `useJobs(filters)` → chave `['jobs', filters]`, com `keepPreviousData` para não piscar ao filtrar
- `useJob(id)` → chave `['job', id]`
- `useUpdateJob` → `PATCH /api/jobs/:id`; no sucesso atualiza o cache do detalhe e invalida
  `['jobs']` e `['stats']`

Erros HTTP viram `ApiError` com `status` e a mensagem do backend. A página de detalhe usa o status
`404` para distinguir “vaga não encontrada” de falha genérica.

## 5. Componentes

| Componente | Responsabilidade |
|---|---|
| `Layout` | Topbar, navegação e rodapé |
| `Dashboard` | Stats, busca, filtro e tabela |
| `JobDetail` | Cabeçalho, troca de status, fit, runs, artefatos e resumo |
| `FitPanel` | Rating, análise, dimensões, forças, gaps e elegibilidade |
| `RunList` | Checkpoints com estágio, flags e snapshot expansível |
| `ArtifactList` | Um link por tipo, apontando para o visualizador correto |
| `StatusBadge` | Cores e rótulos por status |
| `StateMessage` | Loading, erro com retry e vazio |

`ArtifactList` deduplica por `kind` (fica o mais recente) e ordena por relevância. Os links usam os
visualizadores do backend:

- CV → `/cv/:jobId`
- e-mail → `/extras/:jobId/email`
- recrutador/LinkedIn → `/extras/:jobId/recruiter`
- perguntas/sugestões → `/extras/:jobId/suggestions`
- demais → `/applications/<relativePath>`

## 6. Desenvolvimento

Dois terminais:

```bash
# terminal 1 — API
pnpm dev

# terminal 2 — Vite
pnpm dev:web
```

O Vite roda em `http://localhost:5173` e faz proxy de `/api`, `/applications`, `/base_profile`,
`/cv` e `/extras` para `http://localhost:3344`.

## 7. Produção

```bash
pnpm build:web
pnpm start
```

O Express serve `web/dist` na mesma porta da API (`3344`) e faz fallback para `index.html` em rotas
de navegação. Os prefixos `/api`, `/applications`, `/base_profile`, `/cv` e `/extras` **não** caem
no fallback, então um artefato ausente continua `404` em vez de devolver HTML.

`WEB_DIST` permite apontar para outro diretório de build.

## 8. Testes

```bash
pnpm test:web          # 13 testes
pnpm typecheck:web
pnpm build:web
```

Cobrem:

- Formatação de datas, fit, bytes, labels e URL de artefato.
- Dashboard: stats, tabela, filtro de status, busca, vazio e erro com retry.
- Detalhe: fit, runs, artefatos, troca de status via `PATCH` e `404`.

O `fetch` é mockado por teste; não é preciso subir a API. Ver [testing.md](./testing.md).

## 9. Decisões

- **Sem Redux/Zustand.** O cache do TanStack Query cobre o estado do servidor; o resto é local.
- **Sem biblioteca de UI.** CSS próprio para manter o bundle pequeno e o visual próximo do v1.
- **Sem `dangerouslySetInnerHTML`.** Conteúdo de vaga e mensagens são renderizados como texto.
- **Filtros fora da URL por enquanto.** Simplicidade agora; URL state entra se necessário.
- **Um pacote de workspace.** `web/` tem scripts e dependências isolados.

## 10. Próximos passos

1. Página de admin (perfis base, tema de PDF, dados do formulário).
2. Polling de runs em `processing` e ação de responder checkpoint.
3. Filtros na URL e paginação visível.
4. Atualização otimista de status.
5. Substituir de vez o `public/index.html` do v1 e remover as rotas de compatibilidade.
