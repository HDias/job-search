# Plano consolidado — Port do pipeline v1 → v2

> **Documento único.** Consolida e substitui
> [`pipeline-port-v1-v2.md`](../pipeline-port-v1-v2.md) e
> [`pipeline-port-review.md`](../pipeline-port-review.md), removendo a duplicação entre plano e
> revisão. Fontes: leitura integral dos dois arquivos, `docs/README.md`,
> `docs/architecture.md`, `docs/roadmap.md`, `AGENTS.md`, `src/pipeline/**`, `drizzle/*.sql` e
> `git log`.
>
> **Estado verificado em 2026-11-14:** Fases 1 e 2 **concluídas**; Fases 3, 4 e 5 **pendentes**.
> A migração `0003_pipeline_runs.sql` já existe e já foi aplicada na Fase 2.

## 1. Goal

Concluir o port *strangler* do pipeline pesado do v1 para o v2, fechando o que falta:

- **Fase 3** — geração do kit (currículo + carta) e PDF com camada ATS, em `src/pipeline/kit/**`
  e `src/pipeline/pdf.ts`.
- **Fase 4** — fila interativa (`question`/`respond`, rounds ≤ 2) e regeneração de kit, com
  endpoints v2-nativos e shims de compatibilidade.
- **Fase 5** — upload de currículo, UI de checkpoint no React, polimento e aposentadoria da UI
  antiga.

## 2. Context

- App *local-first*: **Express + SQLite + React** (ver `AGENTS.md`).
- v2 é um *strangler* do v1. O v1 continua funcional na porta `3333` como referência/fallback até
  a Fase 5 terminar; as rotas de compatibilidade `/api/applications` e `/api/processes` não podem
  ser removidas até a UI antiga ser aposentada.
- O pipeline vive em `src/pipeline/` e fala com o mundo apenas via repositórios (`Store`),
  `config.ts` e funções injetadas (`fetch`, `sleep`, `browser`). **Sem estado em `fs`**: checkpoints
  são `runs`; artefatos são linhas em `artifacts` (D1).
- Modelo assíncrono: endpoints nativos devolvem **`202 {runId}`** e um worker **FIFO in-process
  (1 execução por vez)** faz o trabalho; a UI já *polla* `/api/jobs/:id` a cada 4 s (D2).
- **Fase 1 (concluída):** `src/pipeline/llm/{client,config}.ts`, `src/pipeline/skills/loader.ts`,
  `src/pipeline/prompts.ts`, assets em `skills/`, rotas `/api/llm-config`, testes
  `llm-client`/`llm-config`/`pipeline-prompts`.
- **Fase 2 (concluída):** `src/pipeline/scrape/job.ts`, `src/pipeline/content.ts`,
  `src/pipeline/fit/**`, `src/pipeline/kit/fit.ts`, `src/pipeline/queue.ts`,
  `src/pipeline/runs/fit-check.ts`, `src/pipeline/service.ts`, rotas `POST /api/fit-check` (202) e
  `POST /api/evaluate-fit` (síncrono), testes `pipeline-*`; migração `0003` aplicada.
- **Lacuna a preencher:** não existem ainda `kit/generate.ts`, `kit/slug.ts`, `kit/validate.ts`,
  `kit/artifacts.ts`, `kit/suggestions.ts`, `pdf.ts`, nem os endpoints de geração/fila/regeneração
  e upload.

### 2.1 Decisões consolidadas (D1–D13)

| ID | Decisão |
|---|---|
| D1 | Todo o pipeline em `src/pipeline/`; checkpoints em `runs`, artefatos em `artifacts`; nada de estado em `fs`. |
| D2 | Endpoints nativos devolvem `202 {runId}`; worker FIFO in-process (1 por vez); UI *polla* runs ativos. |
| D3 | Assets de skill versionados em `skills/job-application-tailor/` e `skills/resume-pdf-renderer/` (scripts não são copiados — portados para TS). `SKILLS_DIR` sobrescreve. v1 intocado. |
| D4 | Config de LLM só em `settings['llm_config']`; `GET /api/llm-config` devolve apenas `hasKey` + `maskedKey`. Chave só no DB; `GEMINI_API_KEY` é fallback legado opcional. Nunca logar o objeto de config. `PUT`/`POST` com semântica parcial (ausente preserva; `apiKey: ''` preserva). |
| D5 | Só `profiles` com `enabled = true` participam; `extraPrompt` injetado via `withExtraPrompt` como instrução de estilo, nunca fato. |
| D6 | Invariantes: replay de pergunta sem nova chamada LLM quando o run está `needs_input` e não veio resposta; whitelist de inferências (só as oferecidas pelo LLM, `confidence: high`, sem numéricas); no máximo 2 rodadas de `needs_input`; `clarificationHistory` com as últimas 2. |
| D7 | Estágios de `runs.stage`: `queued → scraping → scrape-thin | fit-checked → generating ⇄ needs_input → done | failed`. `error` guarda a mensagem; `failed`/`needs_input` são retomáveis. |
| D8 | Endpoints v2-nativos: `POST /api/fit-check` → 202; `POST /api/generate-kit` → 202; `GET /api/runs/:id/question` e `POST /api/runs/:id/respond`; `POST /api/jobs/:id/regenerate` → 202; `POST /api/profiles/:stack/:language/upload`. |
| D9 | Dependências por fase: Fase 1 nenhuma; **Fase 2 `playwright`** (feito); **Fase 5 `multer` + `@types/multer`**; `pdftotext` é dependência de sistema (`poppler-utils`). O browser é reutilizado por worker da fila e é injetável (`browserFactory`) para testes. |
| D10 | `getCandidateFileSlug` lê `settings.candidate_form` (fallback `Horecio-Dias`); tema de PDF vem de `settings.pdf_theme` (centraliza as 3 leituras duplicadas do v1). |
| D11 | `scrape_application_questions.mjs` **fica fora** do pipeline; é CLI standalone no v1, não é chamado por `processJob`. Opcional na Fase 5 (fatia de preenchimento assistido). |
| D12 | `POST /api/evaluate-fit` (fit híbrido determinístico, síncrono, sem LLM) é Fase 2 — **feito**. `calculateFitHybridSync` está quebrado no v1 (import ausente) e **não** é portado. |
| D13 | A chave de LLM vive exclusivamente no DB; nunca exposta em resposta, log ou `error.message` de provider. Opcional: cifrar em repouso. |

### 2.2 Reconciliação de estágios (`runs.stage`)

O vocabulário do v1 + estágios do modelo assíncrono:

```text
queued → scraping → scrape-thin → fit-checked → generating ⇄ needs_input → done | failed
```

| Estágio antigo (v2 pré-port) | Destino |
|---|---|
| `draft` | Aposentar — `queued` vira o estado inicial |
| `processing` | `generating` |
| `awaiting-language` | Aposentar — representado por `needsLanguageConfirmation` + `fit-checked` (v1 usa 409) |
| `awaiting-fit` | Aposentar — representado por `needsFitConfirmation` |
| `error` | `failed` |

> Esta reconciliação foi executada na Fase 2 (inclui `src/domain/run.ts`, `web/src/api/types.ts`,
> `src/api/dto/legacy.ts` e a migração `0003`). Registrada aqui como pré-condição consolidada.

## 3. Out of scope

- `render_pdf.mjs` (contagem de páginas) — wrapper cosmético do v1; **ignorar** (G3).
- `calculateFitHybridSync` — quebrado no v1; **não portar** (D12).
- `scrape_application_questions.mjs` como paridade obrigatória — opcional na Fase 5 (D11).
- `/api/skill-info` + `loadSkillReferences` — painel de transparência opcional, não é paridade
  obrigatória (G9).
- Reescrever/alterar o v1; autenticação/multi-usuário; observabilidade (métricas/tracing).
- Remover as rotas de compatibilidade — só depois de aposentar a UI antiga.
- Editar SQL de migração já aplicada (proibido pelas regras do repo).

## 4. Insights (hierarquia)

### Tier 1 — o plano falha sem isso

- **Kit gerado como passos puros** (`kit/generate.ts`): resolveJobData, currículo do alvo,
  pré-pass determinístico, prompt, parse tolerante, validator retry ≤ 2 (T3.4).
- **Artefatos gravados e registrados** (`kit/artifacts.ts`): pasta
  `applications/<company>_<role>[_N]`, arquivos e linhas em `artifacts` (T3.6).
- **PDF com camada ATS** (`pdf.ts`): `page.pdf` A4 15 mm + `pdftotext -layout` →
  `_ats_layer.txt` + `atsCompatible` (T3.5).
- **Fila interativa**: `generate-kit` com gates 409, replay sem LLM, rounds ≤ 2, retomada
  (T4.1/T4.2).
- **Chave nunca vaza** (D4/D13): `hasKey`/`maskedKey`, nenhum log da config, nenhum `error.message`
  com a key (T4.1, T5.4).

### Tier 2 — relevante

- `kit/slug.ts`, `kit/suggestions.ts`, `kit/validate.ts` (T3.1–T3.3).
- Regeneração de kit (T4.3) e shims de compat `/api/processes/:id/{question,respond}` (T4.4).
- Upload de currículo com `multer` + `pdftotext` (T5.1/T5.2).
- UI de checkpoint no `JobDetail` e painel de LLM no Admin (T5.3/T5.4).
- Testes de request cobrindo gates 409/400 (T4.5).

### Tier 3 — incremental

- Entrypoint discreto para disparar fit-check/geração no React (T5.5).
- `candidate-data` extraindo nome/e-mail/telefone/LinkedIn/GitHub de `profiles.content.rawText`
  (T5.6, G4).
- Pre-fill dry-run (`apply_assistant.mjs`) + `scrape_application_questions.mjs` opcional (T5.7).
- Docs + ADR-0010 (T5.8).

### Não se aplica

- Contagem de páginas do `render_pdf.mjs` (G3).
- `calculateFitHybridSync` (D12).
- Motor híbrido no caminho principal do fit — a separação deve ser mantida (só
  `/api/evaluate-fit` / "Retry fit").
- Cifrar a chave em repouso neste ciclo (opcional do D13, pode virar backlog).

## 5. Research (fontes lidas)

| Fonte | O que foi extraído |
|---|---|
| `.plans/pipeline-port-v1-v2.md` | Plano-mãe: D1–D12, fases, mapa v1→v2, armadilhas, verificação. |
| `.plans/pipeline-port-review.md` | Revisão: D11–D13, reconciliação de estágios, migração `0003`, deltas por fase, itens G2–G9. |
| `docs/README.md` | Status de fases, números atuais, princípios, convenções. |
| `docs/architecture.md` | Containers, módulos do pipeline, estado da Fase 2, limites conhecidos. |
| `docs/roadmap.md` | Fases, backlog técnico, riscos, critério de aposentadoria da UI antiga. |
| `AGENTS.md` | Comandos, ESM/NodeNext (`.js`), pnpm 11, dois Vitests, repositórios, paths/portas, convenções. |
| `src/pipeline/**` (tree) | Confirma Fases 1–2; ausência de `kit/{generate,slug,validate,artifacts,suggestions}.ts` e `pdf.ts`. |
| `drizzle/*.sql` | Confirma `0003_pipeline_runs.sql` já gerada. |
| `git log` | Confirma `#5` (Fase 2) como último marco do pipeline. |

## 6. Task graph

Legenda de prioridade: **P0** = bloqueia o objetivo · **P1** = necessário para paridade ·
**P2** = incremental/opcional. "Paralelo" = pode rodar em paralelo com outras do mesmo nível.

### Fase 3 — Kit + PDF (concluída)

| ID | Prio | Tarefa | Bloqueado por | Paralelo | Done when (mensurável + evidência) | Se falhar |
|---|---|---|---|---|---|---|
| **T3.1** | P0 | `src/pipeline/kit/slug.ts`: `getCandidateFileSlug` (D10), `sanitizeName`, `shortRoleFileSlug` | — | sim | `test/pipeline-kit-slug.test.ts` verde: fallback `Horecio-Dias` quando `candidate_form` vazio, slug a partir de `candidate_form`, caracteres ilegais removidos e truncamento do papel; `pnpm typecheck` exit 0 | F5 |
| **T3.2** | P1 | `src/pipeline/kit/suggestions.ts`: port determinístico de `question_suggestion_engine.mjs` | — | sim | `test/pipeline-kit-suggestions.test.ts` verde com fixture de perguntas; saída idêntica à esperada e **sem** chamada LLM (mock com 0 chamadas) | F5 |
| **T3.3** | P0 | `src/pipeline/kit/validate.ts`: port de `validate_resume_html` + `validateResumeContent` (coverage/hallucination/cliché/ammo/acento), tema via `settings['pdf_theme']` | — | sim | Testes unitários por dimensão verdes; tema lido de `settings` (sem duplicação de `getPdfTheme`); `pnpm typecheck` exit 0 | F4 |
| **T3.4** | P0 | `src/pipeline/kit/generate.ts`: port de `processJob` (:701–1124) em passos puros | T3.1, T3.3 | não | `test/pipeline-kit-generate.test.ts` verde cobrindo: kit válido → `jobId`/artefatos; JSON em cerca tolerado; `needs_input` → pergunta; kit inválido → retry ≤ 2 e depois `failed` resumável | F6 |
| **T3.5** | P0 | `src/pipeline/pdf.ts`: `generatePdf` (Chromium `page.pdf` A4 15 mm `printBackground`, browser injetado/reutilizado) + `pdftotext -layout` → `_ats_layer.txt` + `atsCompatible`; port de `buildCombinedCvWithCoverHtml` (capa após `.accent`, acento único) + `detectCoverLetterInCvRequirement` | — | sim | Teste de HTML combinado (capa primeiro, 1 acento) verde; fixture de PDF gera `_ats_layer.txt` com > 0 chars; `atsCompatible` booleano coerente; nenhum Chromium real na suíte (browser stub) | F1 / F4 |
| **T3.6** | P0 | `src/pipeline/kit/artifacts.ts`: pasta `applications/<company>_<role>[_N]`, grava `job_posting.md`, `fit_check.json`, HTML/PDF, e-mails/mensagens, `application_questions.json`, `materiais_extras/sugestoes_respostas.{json,md}` + `README.md`; registra em `artifacts` (caminho relativo + mime + size) e atualiza `job` | T3.1, T3.2, T3.4, T3.5 | não | Teste de artefatos verifica lista exata de arquivos, linhas em `artifacts` com caminho relativo/mime/size e `job` atualizado (fit + arquivos); idempotência de sufixo `_N` | F5 |
| **T3.7** | P0 | Portar os 3 `node --test` do v1 para Vitest (coverage, thin-content, cover-in-cv) com fixtures | T3.3, T3.4, T3.5, T3.6 | sim (distribuído) | `pnpm test -- test/pipeline-kit-coverage.test.ts test/pipeline-kit-thin-content.test.ts test/pipeline-kit-cover-in-cv.test.ts` verde; 0 regressões na suíte total | F4 |

**Sub-passos do T3.4** (um por responsabilidade, cada um com teste primeiro):

1. `resolveJobData` — resolve job/vaga a partir do input.
2. Carregar currículo do **alvo** (`profiles.content.rawText`; fallback por idioma/stack como no v1).
3. Pré-pass determinístico: `extractCoverageTerms`, ammo, approved-fit, clarificações.
4. Montar prompt do kit (`buildTailorSystemPrompt` + `withExtraPrompt` do alvo habilitado).
5. `parseKitOrQuestion` tolerante (JSON puro e em cerca).
6. Validator retry (máx. 2 fix-prompts) e transição `done`/`needs_input`/`failed`.

### Fase 4 — Fila interativa + regenerar (concluída)

| ID | Prio | Tarefa | Bloqueado por | Paralelo | Done when (mensurável + evidência) | Se falhar |
|---|---|---|---|---|---|---|
| **T4.1** | P0 | `POST /api/generate-kit` → `202 {runId}` + runner; gates 409 (idioma não explícito, fit < 50/eligibility sem `fitConfirmed`, idioma divergente do requerido); replay de `needs_input` sem LLM; `generating` → `done`/`needs_input` (rounds ≤ 2)/`failed` | T3.4, T3.6 | não | `test/pipeline-generate-kit.test.ts` verde: cada gate devolve 409, replay não chama LLM (mock = 0), transições de estágio corretas, `failed` retomável | F5 / F6 |
| **T4.2** | P0 | `GET /api/runs/:id/question` + `POST /api/runs/:id/respond`: validação (400 se `missing_fact` vazia; 400 se aprovação de inferência não oferecida), append de `clarificationHistory` (últimas 2, 2000 chars), retomada no mesmo ponto | T4.1 | não | Testes de request verdes: 400 vazio, 400 inferência não oferecida, histórico limitado a 2/2000, retomada sem perder estado | F5 |
| **T4.3** | P1 | `POST /api/jobs/:id/regenerate` → `202`: re-scrape ou reaproveita `job_posting.md`, reconstrói language gate, preserva `id/date/status/createdAt`, leva `questions` + `mensagem_recrutador_origem.txt`, copia extras faltantes | T3.6, T4.1 | sim (com T4.2) | Teste verifica preservação de `id/date/status/createdAt`, herança de `questions`/mensagem e cópia de extras | F5 |
| **T4.4** | P0 | Compat: `/api/processes/:id` PATCH continua escrevendo nos mesmos campos de `runs`; shims `/api/processes/:id/question` e `/respond` delegam aos equivalentes de `runs` | T4.2 | não | Teste de compat verde: PATCH e shims retornam formato v1 e afetam as mesmas linhas de `runs` | F2 / F5 |
| **T4.5** | P0 | Testes de request cobrindo todos os gates 409/400 e retomadas | T4.1–T4.4 | não | Cobertura explícita de todos os gates; suíte verde sem Chromium real; `pnpm test` exit 0 | F5 |

### Fase 5 — Upload, UI e polimento (pendente)

| ID | Prio | Tarefa | Bloqueado por | Paralelo | Done when (mensurável + evidência) | Se falhar |
|---|---|---|---|---|---|---|
| **T5.1** | P0 | `pnpm add multer` + `pnpm add -D @types/multer` (playwright já na Fase 2; `allowBuilds` cobre better-sqlite3) | — | sim | `package.json`/lockfile atualizados; `pnpm typecheck` exit 0 | F7 |
| **T5.2** | P0 | `POST /api/profiles/:stack/:language/upload`: multipart 10 MB, `pdftotext` para PDF, grava `profiles.content = {sourceFile, language, stack, extractedAt, rawLength, rawText}` | T5.1 | sim | Teste de upload: limite de 10 MB aplicado, PDF extraído via `pdftotext` (stub), shape de `profiles.content` exato | F7 |
| **T5.3** | P0 | React: responder checkpoint no `JobDetail` (pergunta + opções + aprovar/rejeitar inferências) | T4.2 | sim | Teste de componente/integração verde: renderiza pergunta/opções, envia resposta e invalida cache (`useJob`/`useRuns`) | F2 |
| **T5.4** | P1 | React: painel de LLM config no Admin (key mascarada) | — | sim | Teste verifica exibição de `hasKey`/`maskedKey` e que a key em claro nunca é renderizada | F2 |
| **T5.5** | P1 | React: entrypoint discreto para disparar fit-check/geração | T4.1 | sim | Ação dispara `POST /api/fit-check`/`/api/generate-kit` e reflete `202 {runId}` no polling | F2 |
| **T5.6** | P2 | `meta.ts` `candidate-data` GET: portar `extractCandidateFromBase()` (`server.mjs:106–159`): nome/e-mail/telefone/LinkedIn/GitHub de `profiles.content.rawText` | T5.2 | sim | Teste de extração com fixture de `rawText`; fallback para `settings.candidate_form` quando não houver texto | F7 |
| **T5.7** | P2 | Opcional: pre-fill dry-run (port de `apply_assistant.mjs`, "nunca clica Submit") + `scrape_application_questions.mjs` (D11) | T5.2 | sim | Se implementado: teste garante que Submit nunca é clicado; extração de perguntas grava `application_questions.json` | F1 |
| **T5.8** | P1 | Docs: `docs/api.md`, `docs/frontend.md`, `docs/architecture.md` (remover "não roda Playwright/LLM"), roadmap Fase 2/3, **ADR-0010** (pipeline assíncrono no v2) | Conclusão de T3/T4/T5 relevantes | não | Docs atualizados; ADR-0010 presente e referenciado; nenhuma afirmação de doc contradiz o código | F7 |
| **T5.9** | P2 | Critério final: UI v1 pode ser aposentada (roadmap §3, último item) | T5.8 + T5.3/T5.4/T5.5 | não | Nenhuma tela depende de `/api/applications`; checklist do roadmap §3 completo; decisão registrada | F2 |

## 7. Parallel execution map

O executor pode usar subagentes por onda (só dependências entre ondas são bloqueantes).

| Onda | Tarefas paralelas | Pré-requisito |
|---|---|---|
| 1 | **T3.1, T3.2, T3.3, T3.5, T5.1, T5.4** | Fase 2 concluída |
| 2 | **T3.4** | T3.1, T3.3 |
| 3 | **T3.6** | T3.1, T3.2, T3.4, T3.5 |
| 4 | **T3.7** (finalização dos testes portados) | T3.3–T3.6 |
| 5 | **T4.1** | T3.4, T3.6 |
| 6 | **T4.2, T4.3** | T4.1 (+T3.6 em T4.3) |
| 7 | **T4.4, T5.3, T5.5, T5.2** | T4.2 / T4.1 / T5.1 |
| 8 | **T4.5, T5.6, T5.7** | T4.1–T4.4 / T5.2 |
| 9 | **T5.8** | conclusão de T3/T4/T5 |
| 10 | **T5.9** | T5.8 + UI |

> T5.1 e T5.2 podem começar cedo (paralelas à Fase 3) sem dependência do kit.
> T5.4 (painel LLM) não depende de pipeline novo: as rotas já existem em `src/api/routes/meta.ts`.

## 8. Decision gates

| Gate | Momento | PASS | ADJUST | ABORT |
|---|---|---|---|---|
| **G3** | Fim da Fase 3 | `pnpm typecheck` exit 0; `pnpm test` exit 0 com **0 regressões** e ≥ (suíte atual + novos); os 3 testes portados verdes; `pnpm typecheck:web && pnpm test:web && pnpm build:web` exit 0 se `web/src/api/types.ts` mudou; fixture de PDF com `_ats_layer.txt` > 0 chars e `atsCompatible` booleano | Só falham testes novos de fixture/ajuste de tolerância, sem regressão na suíte | typecheck ou suíte existente falham → corrigir antes de avançar |
| **G4** | Fim da Fase 4 | Todos os gates 409/400 cobertos por request tests; replay sem LLM (mock = 0 chamadas); 3ª rodada de `needs_input` rejeitada; `clarificationHistory` ≤ 2 e ≤ 2000 chars | Cobertura de 1 gate faltando, mas comportamento correto | Gate de segurança (key vazando, replay chamando LLM) → Abort e corrigir |
| **G5** | Fim da Fase 5 | Upload multipart 10 MB roundtrip; checkpoint UI renderiza/responde; painel LLM mascara a key; docs + ADR-0010; `pnpm test`/`test:web`/`build:web` verdes; checklist do roadmap §3 completo | Pendências opcionais (T5.6/T5.7) explicitamente registradas como backlog | Dependência de `/api/applications` na UI nova, ou key exposta → Abort |

**Thresholds numéricos:** 0 regressões; `needs_input` ≤ **2** rodadas; `clarificationHistory` ≤ **2**
entradas / **2000** chars; upload ≤ **10 MB**; retry de kit ≤ **2** fix-prompts; timeout de scrape
inalterado em relação ao v1; `git` sem SQL aplicado editado (0 diffs em `drizzle/0000–0003`).

## 9. Failure scenarios

| ID | Cenário | Sinal de detecção | Cascata de recuperação (mais barato primeiro) |
|---|---|---|---|
| **F1** | Chromium/Playwright indisponível no teste/CI | Teste trava ou `launch` lança erro | 1) Injetar `browserFactory` stub e nunca lançar Chromium na suíte; 2) separar geração de HTML (puro) da renderização de PDF; 3) marcar teste de integração como condicional ao binário. |
| **F2** | Chave de LLM vaza (log, resposta ou `error.message`) | `grep` por key em respostas/logs; teste que afirma `maskedKey` | 1) Remover `console.log(config)`/`JSON.stringify(settings)`; 2) sanitizar `error.message` do provider; 3) garantir `hasKey`/`maskedKey` no DTO; 4) rotacionar a key. |
| **F3** | Deriva de migração / SQL já aplicado editado | `drizzle-kit generate` acusa diff; checksum divergente | 1) Nunca editar SQL aplicado; 2) gerar nova migração nomeada; 3) reconciliar `schema.ts` + `domain` + `web/src/api/types.ts`. |
| **F4** | Regressão de PDF/ATS (validador rejeita CV válido) | Teste de fixture de coverage/ATS falha | 1) Ajustar o mapeamento validador↔fixture; 2) reforçar o teste (não afrouxar o código); 3) isolar HTML puro do `pdftotext`. |
| **F5** | Fila interativa trava / perde checkpoint no restart | `needs_input_rounds` > 2 ou run preso | 1) Enforce cap de rounds; 2) runs `failed`/`needs_input` retomáveis; 3) replay sem LLM; 4) FILA FIFO 1 slot com erro→`failed`. |
| **F6** | Geração de kit alucina / parse falha | Validator retry esgotado | 1) Parse tolerante (JSON em cerca); 2) máx. 2 fix-prompts; 3) `failed` resumível com `error`; 4) logar prompt/response sem key. |
| **F7** | Dessincronia de tipos web/backend ou deps | `pnpm typecheck:web` falha; import quebrado | 1) Atualizar `web/src/api/types.ts` junto do domínio; 2) `pnpm install` limpo; 3) `pnpm typecheck && pnpm typecheck:web`. |

## 10. TDD strategy

Cada fase TDD cobre **um comportamento** e cicla **red → green → refactor**. Teste primeiro; nunca
implementar sem um teste vermelho correspondente.

| Fase | Comportamento | Red (teste que falha primeiro) | Green (implementação mínima) |
|---|---|---|---|
| **P1** | Slug do candidato | Espera `Horecio-Dias` quando `candidate_form` vazio; slug a partir de `candidate_form` | `getCandidateFileSlug` + `sanitizeName` + `shortRoleFileSlug` |
| **P2** | Sugestões determinísticas | Saída esperada de fixture, 0 chamadas LLM | Port de `question_suggestion_engine.mjs` |
| **P3** | Validação do currículo | Fixture com termo faltante / fato inventado / clichê / acento / ammo | `validate_resume_html` + `validateResumeContent` |
| **P4** | Geração do kit | Kit válido, JSON em cerca, `needs_input`, retry ≤ 2 | `generate.ts` em passos puros |
| **P5** | PDF + ATS | Capa após `.accent` e acento único; `_ats_layer.txt` > 0 | `pdf.ts` com browser stub |
| **P6** | Artefatos | Lista exata de arquivos + linhas em `artifacts` + `job` atualizado | `artifacts.ts` |
| **P7** | `generate-kit` | 409 por gate; replay sem LLM; transições de estágio | Rota + runner |
| **P8** | `question`/`respond` | 400 vazio; 400 inferência não oferecida; histórico ≤ 2/2000 | Rotas de fila |
| **P9** | `regenerate` | Preserva `id/date/status/createdAt`; herda `questions`/mensagem | Rota de regeneração |
| **P10** | Upload | 10 MB; `pdftotext`; shape de `profiles.content` | Rota multipart |
| **P11** | UI checkpoint | Renderiza pergunta/opções; envia resposta; key mascarada | Componentes React |

## 11. Mutation testing (técnica, não ferramenta)

Para os comportamentos críticos, os testes **devem matar** estes mutantes. Mutante sobrevivente
= teste fraco → **reforçar o teste**, nunca afrouxar o código.

| Mutação | Onde | Teste que deve matar |
|---|---|---|
| `<= 2` → `< 2` (rounds de `needs_input`) | T4.1/T4.2 | Exatamente 2 rodadas permitidas e a 3ª rejeitada |
| `fit < 50` → `fit <= 50` | gate 409 do `generate-kit` | Caso de fit exatamente **50** |
| `confidence === 'high'` → aceitar `'medium'` | whitelist de inferências (D6) | Aprovação de inferência `medium` retorna 400 |
| `maskedKey` `slice` inicial/final | D4/D13 | Formato `abc123...wxyz` e ausência da key completa |
| `atsCompatible: true` ↔ `false` | T3.5 | Fixture com/sem camada ATS |
| `>=` → `>` no threshold de coverage | T3.3 | Fixture no limite exato |
| `maxRetries` / `fix-prompts` ±1 | T3.4 | Contagem de chamadas no limite (2) |
| `rounds` de `clarificationHistory` (2 → 3) | T4.2 | Histórico com 2 entradas mantém só as 2 |
| gate de idioma (explicito ↔ divergente) | T4.1 | Cada um dos 3 gates 409 isoladamente |
| `enabled` de `profiles` `true` → `false` | D5 | Alvo desabilitado não participa |

## 12. Test plan

- **Backend (Vitest, Node):** `pnpm test` — suíte atual (134) + novos `pipeline-kit-*`,
  `pipeline-generate-kit`, `pipeline-question`, `pipeline-regenerate`, upload.
- **Frontend (Vitest, jsdom):** `pnpm test:web` — checkpoint, painel LLM, entrypoint.
- **Sem Chromium real:** todo teste de scrape/PDF injeta `browserFactory` stub (F1).
- **Sem rede/LLM real:** `createLlmClient` mock; asserts de contagem de chamadas (replay = 0).
- **Fixtures:** currículo/vaga, relatório de coverage, PDF de exemplo, `job_posting.md`.
- **Comandos focados:**

```bash
pnpm test -- test/pipeline-kit-slug.test.ts
pnpm test -- test/pipeline-kit-generate.test.ts
pnpm test -- test/pipeline-generate-kit.test.ts
pnpm test -- test/pipeline-question.test.ts
```

- **Gate completo (antes de cada entrega):**

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # a partir da Fase 2 (se web/src/api/types.ts mudar)
pnpm build:web                        # a partir da Fase 2
```

## 13. Acceptance criteria

- [x] Fase 3: kit gerado (currículo + carta) e PDF com camada ATS, artefatos registrados e `job`
      atualizado; 3 testes portados verdes; 0 regressões.
- [x] Fase 4: `generate-kit`, `question`/`respond` e `regenerate` funcionando; gates 409/400
      cobertos; replay sem LLM; rounds ≤ 2; compat `/api/processes` intacta.
- [x] Fase 5: upload de currículo; checkpoint, painel de LLM e entrypoints no React; docs + ADR-0010
      (T5.7/T5.9 explicitly registered as backlog).
- [x] Chave de LLM nunca exposta (`hasKey`/`maskedKey`); nenhum SQL aplicado editado.
- [x] `pnpm typecheck && pnpm test && pnpm typecheck:web && pnpm test:web && pnpm build:web`
      verdes (285 backend tests / 28 files, 39 frontend tests / 8 files).
- [ ] Critério do roadmap §3: UI antiga pode ser aposentada.

## Execution status

O executor marca cada item ao concluir. Um checkbox por tarefa.

- [x] T3.1 — `kit/slug.ts` — `pnpm test -- test/pipeline-kit-slug.test.ts` green (fallback, candidate_form, illegal chars, role truncation); `pnpm typecheck` exit 0.
- [x] T3.2 — `kit/suggestions.ts` — `pnpm test -- test/pipeline-kit-suggestions.test.ts` green (contact/skills extraction, standard field mapping, technical + legal answers, demographic default, compound decomposition, markdown render); synchronous, no LLM client.
- [x] T3.3 — `kit/validate.ts` + `pdf-theme.ts` — `pnpm test -- test/pipeline-kit-validate.test.ts` green (layout classes, single accent band/color, no external assets, no multi-column, coverage/hallucination/cliché/ammo/core warnings, coverage threshold boundary); theme read from `settings['pdf_theme']`; `pnpm typecheck` exit 0.
- [x] T3.4 — `kit/generate.ts` — `pnpm test -- test/pipeline-kit-generate.test.ts` green (snapshot/pasted job resolution, fenced-JSON tolerant parse, needsInput envelope validation and rounds cap 2, clarification/coverage blocks in the prompt, valid kit as `done`, exactly two fix prompts then `failed` with the violation codes, fixed-on-second-attempt accepted); `pnpm typecheck` exit 0.
- [x] T3.5 — `pdf.ts` — `pnpm test -- test/pipeline-pdf.test.ts` green (cover detected/ignored incl. "separate files" and PT phrasing; combined HTML puts the cover right after the single `.accent` with `page-break-after`; A4 15 mm `printBackground` through an injected browser; `_ats_layer.txt` written; `atsCompatible` true > 100 chars, false for short text and for a failing `pdftotext`); no real Chromium in the suite.
- [x] T3.6 — `kit/artifacts.ts` — `pnpm test -- test/pipeline-kit-artifacts.test.ts` green (exact 17-file kit for posting+fit+questions+recruiter+guidance+suggestions+resume/cover/combined+email; artifact rows with relative path/mime/size and kinds; job updated with fit, flags, cover-in-CV and guidance; `_2` folder suffix on a second write; `includeCoverInCv: 'never'` skips the combined variant); `pnpm typecheck` exit 0.
- [x] T3.7 — ported v1 tests — `pnpm test -- test/pipeline-kit-coverage.test.ts test/pipeline-kit-thin-content.test.ts test/pipeline-kit-cover-in-cv.test.ts` green (coverage mustCover/forbidden/React exclusion/baseSnippet, logistics note, content+layout validators, ammo year exclusion, thin scrape asks for pasted text with 0 LLM calls, cover-in-CV YES/NO matrix and combined layout); full suite 227 tests green, `pnpm typecheck` exit 0, 0 regressions.
- [x] T4.1 — `POST /api/generate-kit` + runner — `pnpm test -- test/pipeline-generate-kit.test.ts` green (409 for missing explicit language, fit < 50, failed eligibility and explicit language divergence; fit exactly 50 and mere detection divergence proceed; `fitConfirmed: true` bypasses; happy path writes artifacts and links a job; `needs_input` stores the question and replay makes 0 extra LLM calls; a third round is rejected; validation `failed` is resumable to `done`; disabled profiles fail with 0 LLM calls); `pnpm typecheck` exit 0.
- [x] T4.2 — `GET /api/runs/:id/question` + `POST /api/runs/:id/respond` — `pnpm test -- test/pipeline-question.test.ts` green (404 unknown/not waiting, pending question + rounds, 409 not waiting, 400 empty `missing_fact`, 400 inference not offered, offered inference approval without free text, resume keeps stack/language/guidance and finishes `done`, history capped at 2 entries with a 2000-char answer, a second question keeps `needs_input` with rounds = 2); `pnpm typecheck` exit 0.
- [x] T4.3 — `POST /api/jobs/:id/regenerate` — `pnpm test -- test/pipeline-regenerate.test.ts` green (404 unknown job, 409 language conflict, 400 without snapshot/pasted text, job `id/status/appliedAt/createdAt` preserved across regeneration with language moved to the posting-required one, old `application_questions.json` + suggestions JSON/MD + recruiter origin copied into the new `_2` folder with `hasQuestions`/`hasRecruiterMessage` set, pasted-text regeneration works without a snapshot); `pnpm typecheck` exit 0.
- [x] T4.4 — compat shims — `pnpm test -- test/pipeline-compat.test.ts` green (`GET /api/processes/:id/question` returns the v1 `{ processId, question, needsInputRounds }`; `POST /api/processes/:id/respond` answers the same run, appends history and returns `202 { success, processId, runId }`; v1 error messages preserved; `PATCH /api/processes/:id` writes the same `runs` columns as `PUT`); `pnpm typecheck` exit 0.
- [x] T4.5 — `test/pipeline-request-gates.test.ts` — gate matrix green: generate-kit (missing language, fit < 50, failed eligibility, explicit language conflict, 400 empty body), question/respond (404 unknown, 404 non-pending, 409 non-waiting, 400 empty answer, 400 inference not offered), regenerate (404 unknown job, 400 no source, 409 language conflict); the LLM stub would throw if a gate reached the queue. Full suite **271 tests / 26 files**, no real Chromium or network; `pnpm typecheck && pnpm test` exit 0.
- [x] T5.1 — deps `multer` + `@types/multer` — added `multer@^2.5.0` (runtime) and `@types/multer@^2.3.0` (dev) to `package.json`/lockfile; `pnpm typecheck` exit 0.
- [x] T5.2 — `POST /api/profiles/:stack/:language/upload` — `pnpm test -- test/pipeline-upload.test.ts` green (multipart `resumeFile` field, text resume stored with the exact `{sourceFile, language, stack, extractedAt, rawLength, rawText}` content, PDF routed through an injected `pdftotext` runner with the raw bytes, existing `enabled`/`extraPrompt` preserved on replacement, 413 above 10 MB with no profile written, 400 without a file, 400 for invalid stack/language, 422 when extraction throws or yields blank text, `createResumeTextExtractor` sends only `.pdf` to `pdftotext`); uploads stay in memory (no `fs` state) and nothing is spawned in the suite; `pnpm typecheck && pnpm test` → 279 tests / 27 files, 0 regressions.
- [x] T5.3 — React checkpoint no `JobDetail` — `pnpm test:web -- JobCheckpoint` green (renders the question and the suggested options, answers a missing fact and refetches `['job', id]` so the panel disappears, disables submit while the answer is empty, approves/rejects inferred skills into `approvedInferences`/`rejectedInferences`, shows the API error without losing the chosen answer); `pnpm typecheck:web` exit 0.
- [x] T5.4 — React painel LLM no Admin — `pnpm test:web -- Admin` green (renders the masked `maskedKey` only, never the full key in the DOM, saves provider/model without resending an empty key, sends a newly typed key); `pnpm typecheck:web` exit 0.
- [x] T5.5 — React entrypoint fit-check/geração — `pnpm test:web -- JobPipelineActions` green (fit-check posts the vacancy URL + process/stack and refetches the job so polling picks up the 202, generate-kit posts the latest `processId`, both actions disabled without a source, the 409 gate message is surfaced); `pnpm typecheck:web && pnpm test:web && pnpm build:web` exit 0.
- [x] T5.6 — `candidate-data` (`extractCandidateFromBase`) — `pnpm test -- test/candidate-data.test.ts` green (email/phone/LinkedIn/GitHub and the header name from `profiles.content.rawText`, section headings and role titles skipped, first value across the ruby→php profile order wins, saved `candidate_form` fills only the blanks, empty saved strings do not erase extracted values, empty shape with neither source); name regex no longer swallows the next line; `pnpm typecheck` exit 0.
- [~] T5.7 — (opcional) pre-fill dry-run + `scrape_application_questions` — **backlog by decision (D11):** both are standalone v1 scripts outside `processJob`, so parity does not depend on them. Registered in `docs/roadmap.md`.
- [x] T5.8 — docs + ADR-0010 — `docs/api.md` (kit, question/respond, regenerate, upload, 413/422 and the parity section), `docs/architecture.md` (phase status, module table and flow), `docs/frontend.md` (checkpoint, LLM panel, pipeline actions, upload note), `docs/testing.md` (new suites and the Chromium/`pdftotext` rows), `docs/roadmap.md` (Phase 3 and backlog), `docs/README.md`, `docs/security.md`, `docs/development.md` (`poppler-utils`), `docs/glossary.md` and `AGENTS.md`; `docs/adr/0010-async-pipeline.md` added and indexed in `docs/adr/README.md`.
- [~] T5.9 — aposentar UI v1 — **not executed:** no React screen calls `/api/applications` (checked with `grep -rn "/api/applications" web/src` → 0 hits), but retiring v1 still needs an upload control in the SPA and the removal of the `/api/applications` + `/api/processes` compatibility routes. Registered as backlog in `docs/roadmap.md`; the compatibility DTOs stay untouched per AGENTS.md.
