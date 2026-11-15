# Plano — Fechar o ciclo de candidatura + interação pós-resposta da LLM

> Complementa o port do pipeline (`.plans/2026-11-14-pipeline-port/plan.md`), que está
> concluído. Cobre as três lacunas que faltam para o app ser usado de ponta a ponta:
> (1) **apply-confirm** (marcar como aplicado), (2) **botões de prefill/extração de perguntas
> no React** e (3) **chat pós-resposta com a LLM** (novo, não existe no v1).
>
> Fontes: leitura integral de `src/domain/job.ts`, `src/domain/run.ts`, `src/db/schema.ts`,
> `src/api/routes/{jobs,pipeline,compat}.ts`, `src/pipeline/service.ts`,
> `src/repositories/types.ts`, `web/src/api/{client,hooks,types}.ts`,
> `web/src/{pages/JobDetail.tsx,components/PipelineActions.tsx}` e do v1
> (`server.mjs` `apply-confirm`/`prefill`, `AGENTS.md`, `README.md`).

## 1. Goal

Fechar o ciclo de uso real do app e adicionar conversa pós-resposta:

- **Apply-confirm** — registrar que o usuário aplicou manualmente (nota, canal, e-mails,
  data), com trava human-in-the-loop (`approved: true`), portando o `POST
  /api/applications/:id/apply-confirm` do v1 para o v2.
- **Prefill + perguntas no React** — expor na UI os endpoints já prontos
  `/api/jobs/:id/prefill` (dry-run) e `/api/jobs/:id/questions` (extração).
- **Chat pós-resposta** — conversa multi-turno com a LLM sobre a vaga/fit/kit **depois** que
  o pipeline respondeu, com **chat livre + ações rápidas**. É uma feature nova (no v1 só existe
  a fila interativa `needs_input` durante a geração, nunca um diálogo depois).

## 2. Context

- App local-first: **Express + SQLite + React** (ver `AGENTS.md`). O port do pipeline está 100%
  concluído; o que falta é o fechamento do ciclo de candidatura e a conversa pós-resposta.
- `jobs` já tem `status`, `channel`, `appliedAt`, `appliedEmails` (e `fitJson` document-shaped).
  **Faltam** `applyNote` e `applyMethod`, e não existe nenhum lugar para o histórico de chat.
- `runs` já tem `jobSnapshot` (texto raspado da vaga) e `fit` (ou `jobs.fit`) — é isso que o
  chat usa como contexto.
- O serviço (`src/pipeline/service.ts`) é o único ponto de wiring; as rotas HTTP só falam com
  ele ou com o `Store` (repositórios). `createLlmClient().call(prompt, system)` faz chamadas
  com retry/backoff (2 s/6 s/12 s) e nunca loga a chave.
- Padrão document-shaped: `fit_json`, `job_json`, `job_snapshot`, `clarification_history` são
  colunas JSON. O histórico do chat segue o mesmo padrão.
- O `POST /api/jobs/:id/prefill` e `/api/jobs/:id/questions` **já existem e estão testados**
  (assíncronos no handler, com `applyBrowser` injetável); falta apenas o client/hooks/componente.

### 2.1 Decisões (D1–D8)

| ID | Decisão |
|---|---|
| **D1** | Apply-confirm v2-nativo em `POST /api/jobs/:id/apply-confirm`, com trava `approved === true` (senão `400`), igual ao v1. Shim de compat `POST /api/applications/:id/apply-confirm` mantém a UI antiga funcionando. |
| **D2** | Novas colunas em `jobs`: `apply_note` (text) e `apply_method` (text, default `'manual'`). Migração `0004_apply_confirm`. |
| **D3** | **Chat é síncrono** (`POST /api/jobs/:id/chat` aguarda a LLM e devolve `{ reply, chat }`), como `/prefill`/`/questions` — não passa pela fila 202. Razão: conversa exige resposta imediata, e a fila FIFO (1 slot) serializaria o chat atrás de jobs pesados. |
| **D4** | Histórico do chat como coluna JSON `chat_history` em `jobs` (uma thread por vaga, sobrevive entre runs de fit/kit/regenerate). Migração `0005_job_chat`. |
| **D5** | Contexto do chat = `jobSnapshot.content` (vaga) + `fit` (rating/dimensões/strengths/gaps/analysis) + histórico. A instrução **zero-mentira** (references da skill) é sempre injetada no system prompt. |
| **D6** | Ações rápidas são **prompts pré-definidos no frontend** (ex.: "Resumir o fit", "Apontar gaps", "Reescrever a carta"). Enviam texto pela mesma rota; **não** reescrevem artefatos (isso continua via "Gerar kit"/`regenerate`). |
| **D7** | Endpoints novos: `POST /api/jobs/:id/apply-confirm` e `POST /api/jobs/:id/chat`. O apply-confirm vive em `jobs.ts` (só `Store`); o chat vive em `pipeline.ts` (precisa de `PipelineService`). |
| **D8** | Prefill/perguntas no React **só consomem** os endpoints existentes — nenhuma mudança de backend. |

## 3. Out of scope

- **Não** portar submissão automática (o app nunca clica Submit — nem no v1). Apply-confirm é
  só o registro manual "já apliquei".
- **Não** fazer o chat reescrever artefatos (PDF/HTML/carta) — isso segue via `regenerate` +
  `coverLetterGuidance`. Uma eventual integração "chat → regenerate" fica como backlog.
- **Não** portar `render_pdf.mjs`, `calculateFitHybridSync` (já decididos fora de escopo no
  plano anterior).
- **Não** aposentar a UI antiga nem remover as rotas de compat (decisão explícita separada,
  roadmap §3).
- **Não** autenticação/multi-usuário; **não** streaming de tokens (a resposta vem inteira).

## 4. Insights (hierarquia)

### Tier 1 — o plano falha sem isso

- **Apply-confirm com trava** (`approved === true`, transição `status='applied'`, `appliedAt`,
  `applyNote`, `applyMethod`, `channel`, `appliedEmails` saneados) — AC1/AC2.
- **Chat com contexto e grounding** (`respondToChat` monta prompt com vaga + fit + histórico e a
  instrução zero-mentira; histórico anexa `user` antes de `assistant`) — CH1/CH2.
- **Novas colunas e migrações** (`apply_note`, `apply_method`, `chat_history`) sem editar SQL
  já aplicado — X1/X2.

### Tier 2 — relevante

- Botões de prefill/extração de perguntas no React (PQ1).
- Shim de compat do apply-confirm (AC3).
- UI de apply-confirm no `JobDetail` (AC2).
- `ChatPanel` com chat livre + ações rápidas (CH2).

### Tier 3 — incremental

- Truncar/limitar o histórico de chat enviado ao prompt (últimas N mensagens) — otimização.
- Ação "reescrever a carta" já devolve texto; integrar com `regenerate` é backlog.

### Não se aplica

- Submissão automática de formulário (nunca existiu e continua proibida).
- Fila 202 para o chat (D3 — síncrono).
- `calculateFitHybridSync`, `render_pdf.mjs` (fora de escopo herdado).

## 5. Research (fontes lidas)

| Fonte | O que foi extraído |
|---|---|
| `server.mjs` (v1) `:1449–1476` | `apply-confirm`: exige `approved: true`, seta `status='applied'`, `applyMethod='manual'`, `channel`, `appliedEmails` (limpa até 10), `appliedAt`, `applyNote` (≤500). |
| `server.mjs` (v1) `:1386–1441` | `prefill` (dry-run) — já portado como `POST /api/jobs/:id/prefill`. |
| `src/domain/job.ts` | `Job` atual sem `applyNote`/`applyMethod`/`chatHistory`; `JOB_STATUSES` já inclui `applied`. |
| `src/domain/run.ts` | `jobSnapshot.content` (vaga) e `fit` são o contexto natural do chat. |
| `src/db/schema.ts` | Colunas atuais de `jobs`; migrações `0000`–`0003` aplicadas (próxima `0004`/`0005`). |
| `src/api/routes/jobs.ts` | `createJobsRouter(store)` — só `Store`; apply-confirm cabe aqui. |
| `src/api/routes/pipeline.ts` | `createPipelineRouter(store, pipeline)` — `prefill`/`questions`/`regenerate` como modelo de rota síncrona/202. |
| `src/pipeline/service.ts` | `PipelineService` é o wiring point; `checkFit` usa `createLlmClient().call`; padrão de outcome union (`not_found`/`no_url`/`ok`). |
| `src/repositories/types.ts` | `JobRepository.update(id, patch)` já cobre os novos campos via `JobPatch`. |
| `web/src/api/{client,hooks,types}.ts` | Padrão de client methods + mutations (TanStack Query) + espelhamento de tipos. |
| `web/src/pages/JobDetail.tsx`, `components/PipelineActions.tsx` | Onde entram os novos componentes (ao lado de `PipelineActions`). |
| `docs/roadmap.md` §1 backlog | "React buttons for the pre-fill dry-run and question extraction" — item explícito a fechar. |

## 6. Task graph

Legenda: **P0** = bloqueia o objetivo · **P1** = paridade/necessário · **P2** = incremental.
"Paralelo" = pode rodar em paralelo com outras do mesmo nível.

| ID | Prio | Tarefa | Bloqueado por | Paralelo | Done when (mensurável + evidência) | Se falhar |
|---|---|---|---|---|---|---|
| **X1** | P0 | Migrações `0004_apply_confirm` (`apply_note`, `apply_method`) e `0005_job_chat` (`chat_history` JSON); atualizar `src/db/schema.ts`, `src/domain/job.ts` (`Job`, `ChatMessage`, `chatMessageSchema`, `newJobBaseSchema`/`jobPatchSchema`, `applyConfirmInputSchema`) e `web/src/api/types.ts` (Job + `ChatMessage`) | — | não (dono único de schema/domínio/tipos) | `pnpm typecheck && pnpm typecheck:web` exit 0; `drizzle-kit generate` produziu `0004`/`0005`; nenhum SQL `0000–0003` editado | F3 / F2 |
| **X2** | P0 | Mappers + `JobRepository` leem/escrevem `applyNote`, `applyMethod`, `chatHistory` | X1 | não | Teste de roundtrip do repositório verde (create/update/read dos 3 campos); `pnpm typecheck` exit 0 | F2 |
| **AC1** | P0 | `src/pipeline/apply/confirm.ts` (`confirmApplication(store, jobId, input)` → outcome union) + rota `POST /api/jobs/:id/apply-confirm` em `jobs.ts` | X2 | sim (com CH1) | `test/apply-confirm.test.ts` verde: 404 desconhecida, 400 sem `approved: true`, happy-path seta `status='applied'` + `appliedAt` ISO + `applyMethod='manual'` + `applyNote`≤500 + `channel` + `appliedEmails` saneados (dedupe, ≤10, trim); `pnpm typecheck` exit 0 | F5 |
| **CH1** | P0 | `src/pipeline/chat.ts` (`respondToChat({store, loader, llm}, jobId, message)`) + método `PipelineService.chat` + rota `POST /api/jobs/:id/chat` em `pipeline.ts` | X2 | sim (com AC1) | `test/chat.test.ts` verde: 404 desconhecida, 400 mensagem vazia, 409 sem contexto (sem snapshot/fit), happy-path devolve `{ reply, chat }` com `user` antes de `assistant`, prompt contém vaga + fit + instrução zero-mentira, mock LLM conta 1 chamada, nenhuma key no `error.message`; `pnpm typecheck` exit 0 | F4 / F6 / F7 |
| **PQ1** | P0 | `web/src/api/types.ts` + `client.ts` (`prefill`, `questions`) + `hooks.ts` (`usePrefill`, `useQuestions`) + componente `ApplyActions.tsx` (dois botões + resultado: screenshot/report URL, platform, contagem de perguntas) e montar no `JobDetail` | — (endpoints já existem) | sim | `pnpm test:web -- JobApplyActions` verde: renderiza botões, desabilita sem `applyUrl`/kit, exibe resultado no sucesso, mostra erro 400/404; `pnpm typecheck:web` exit 0 | F1 / F2 |
| **AC2** | P0 | UI de apply-confirm no React: botão "Marcar como aplicada" + formulário (nota, canal, e-mails) + hook `useApplyConfirm` | AC1 | sim (com CH2, PQ1) | `pnpm test:web -- JobApplyConfirm` verde: abre formulário, envia `approved: true` + campos, invalida `['job', id]`, mostra erro 400 sem aprovação; `pnpm typecheck:web` exit 0 | F2 |
| **CH2** | P0 | `ChatPanel.tsx` (lista de mensagens + input + botões de ação rápida) + hook `useChat` + montar no `JobDetail` | CH1 | sim (com AC2, PQ1) | `pnpm test:web -- JobChat` verde: renderiza histórico, envia mensagem (loading → reply anexado), ação rápida envia prompt pré-definido, mostra erro 409 sem contexto; `pnpm typecheck:web` exit 0 | F2 |
| **AC3** | P1 | Shim de compat `POST /api/applications/:id/apply-confirm` delegando a `confirmApplication` | AC1 | sim | `test/apply-confirm.test.ts` verde no formato v1 (`{ success, application }`) afetando as mesmas colunas de `jobs` | F5 |
| **X3** | P1 | Docs: `docs/api.md`, `docs/frontend.md`, `docs/architecture.md`, `docs/roadmap.md` (tirar os itens do backlog) + ADR-0011 (chat pós-resposta síncrono) indexado em `docs/adr/README.md` | AC1, CH1, PQ1, AC2, CH2 | não | Docs consistentes; ADR-0011 presente e referenciado; nenhuma afirmação de doc contradiz o código | F2 |
| **X4** | P0 | Gate completo | X1–X3 | não | `pnpm typecheck && pnpm test && pnpm typecheck:web && pnpm test:web && pnpm build:web` exit 0, 0 regressões (baseline: 302 backend / 43 frontend) | F2 / F3 |

**Sub-passos do CH1** (um por responsabilidade, teste primeiro):

1. `ChatMessage` + `chatHistory` no domínio (X1/X2 já cobrem a coluna).
2. `buildChatSystemPrompt` — junta vaga + fit + instrução zero-mentira (reusa `createSkillLoader`).
3. `respondToChat` — anexa `user`, chama `llm.call(prompt, system)`, anexa `assistant`, persiste.
4. `PipelineService.chat(jobId, message)` — wiring (loader + llm + store).
5. Rota `POST /api/jobs/:id/chat` — validação Zod (`message: z.string().trim().min(1)`), gates 404/409, resposta `{ reply, chat }`.

## 7. Parallel execution map

O executor pode usar subagentes por onda (só dependências entre ondas são bloqueantes). X1 e X2
têm dono único porque tocam `schema.ts` + `domain/job.ts` + `types.ts` (evitar conflito de merge).

| Onda | Tarefas paralelas | Pré-requisito |
|---|---|---|
| 1 | **X1** | — |
| 2 | **X2**, **PQ1** | X1 (X2); PQ1 não depende de backend novo |
| 3 | **AC1**, **CH1** | X2 |
| 4 | **AC2**, **CH2**, **AC3** | AC1 (AC2/AC3), CH1 (CH2) |
| 5 | **X3** | AC1, CH1, PQ1, AC2, CH2 |
| 6 | **X4** | tudo |

> PQ1 (botões de prefill/perguntas) pode começar já na onda 1/2, pois os endpoints existem e
> não dependem de X1/X2/AC1/CH1.

## 8. Decision gates

| Gate | Momento | PASS | ADJUST | ABORT |
|---|---|---|---|---|
| **G1** | Fim de X1/X2 | `pnpm typecheck && pnpm typecheck:web` exit 0; `drizzle-kit generate` gera `0004`/`0005` sem diff; roundtrip do repositório verde; `git status` sem SQL `0000–0003` editado | `drizzle-kit` aponta coluna faltando → ajustar `schema.ts` e regerar (nunca editar SQL aplicado) | SQL aplicado editado ou diff não resolvível → corrigir antes de avançar |
| **G2** | Fim de AC1/CH1 | `pnpm test -- test/apply-confirm.test.ts test/chat.test.ts` verde; gates 404/400/409 todos cobertos; mock LLM = 1 chamada; key nunca aparece em resposta/log | 1 gate de borda sem teste, comportamento correto → cobrir e prosseguir | `approved: true` aceito como `false`/omitido, ou key vazando no chat → Abort e corrigir |
| **G3** | Fim de AC2/CH2/PQ1 | `pnpm test:web -- JobApplyActions JobApplyConfirm JobChat` verde; nenhuma tela quebra; 0 regressões frontend | Falha só de fixture/texto, sem regressão → ajustar teste | Componente quebra o fluxo existente do `JobDetail`, ou chama endpoints errados → Abort |
| **G4** | Fim (X4) | `pnpm typecheck && pnpm test && pnpm typecheck:web && pnpm test:web && pnpm build:web` exit 0, 0 regressões | Pendências P2 (truncar histórico) registradas como backlog | typecheck ou suíte existente falham → corrigir antes de fechar |

**Thresholds numéricos:** `approved` deve ser estritamente `true`; `applyNote` ≤ **500** chars;
`appliedEmails` ≤ **10** entradas; `channel` ≤ **30** chars; chat sem contexto → **409**;
histórico de chat persistido **por vaga** (não por run); 0 regressões.

## 9. Failure scenarios

| ID | Cenário | Sinal de detecção | Cascata de recuperação (mais barato primeiro) |
|---|---|---|---|
| **F1** | Chromium indisponível nos testes de prefill/perguntas | Teste trava ou `launch` lança erro | 1) Backend já injeta `applyBrowser` stub (nada muda); 2) testes de UI mockam o hook/api, nunca navegam; 3) nunca lançar Chromium na suíte. |
| **F2** | Dessincronia de tipos web/backend | `pnpm typecheck:web` falha; campo não renderizado | 1) Atualizar `web/src/api/types.ts` junto do domínio; 2) `pnpm typecheck && pnpm typecheck:web`; 3) `pnpm build:web`. |
| **F3** | Deriva de migração / SQL aplicado editado | `drizzle-kit generate` acusa diff; checksum divergente | 1) Nunca editar SQL aplicado; 2) gerar migração nova nomeada; 3) reconciliar `schema.ts` + `domain` + `types.ts`. |
| **F4** | Chat alucina / ignora grounding | Teste de fixture: resposta inventa fato fora do snapshot | 1) Reforçar a instrução zero-mentira no system prompt; 2) manter snapshot+fit no contexto; 3) logar prompt/resposta sem key. |
| **F5** | Estados 404/400/409 das novas rotas incorretos | Request test falha em um gate | 1) Corrigir a validação Zod / outcome union; 2) cobrir cada gate isoladamente; 3) compat shim delega à mesma lógica (não duplica). |
| **F6** | LLM falha/parse no chat | Retry esgotado ou resposta não-texto | 1) `llm.call` já tem retry 2 s/6 s/12 s; 2) devolver erro amigável (500 com mensagem sem key); 3) não perder a mensagem do usuário (anexar só em sucesso). |
| **F7** | Chave de LLM vaza no chat | `grep` por key em resposta/log; teste de `maskedKey` | 1) Nunca logar o objeto de config; 2) sanitizar `error.message` do provider; 3) resposta do chat só carrega `{ reply, chat }` (nada de config). |

## 10. TDD strategy

Cada fase cobre **um comportamento** e cicla **red → green → refactor**. Teste primeiro; nunca
implementar sem um teste vermelho correspondente.

| Fase | Comportamento | Red (teste que falha primeiro) | Green (implementação mínima) |
|---|---|---|---|
| **P1** | Campos novos no domínio | Roundtrip do repositório espera `applyNote`/`applyMethod`/`chatHistory` persistidos | Mappers + colunas/migrações |
| **P2** | `confirmApplication` | 400 sem `approved: true`; happy-path marca `applied` | Helper + rota |
| **P3** | Compat do apply-confirm | Shim devolve `{ success, application }` e afeta as mesmas colunas | Shim delegando |
| **P4** | `respondToChat` | Mock LLM devolve reply; histórico anexa `user`→`assistant`; prompt tem grounding | Módulo `chat.ts` |
| **P5** | Rota do chat | 404/400/409/happy com `{ reply, chat }` | Rota + service method |
| **P6** | Client/hooks prefill+perguntas | Hook chama o endpoint certo; tipos compilam | `client.ts` + `hooks.ts` + `types.ts` |
| **P7** | `ApplyActions` | Renderiza botões, desabilita sem `applyUrl`/kit, mostra resultado/erro | Componente |
| **P8** | UI apply-confirm | Form envia `approved: true`, invalida cache, mostra 400 | Componente + hook |
| **P9** | `ChatPanel` | Renderiza histórico, envia, anexa reply, ação rápida | Componente + hook |
| **P10** | Gate completo | Suíte total verde, 0 regressões | — |

## 11. Mutation testing (técnica, não ferramenta)

Para os comportamentos críticos, os testes **devem matar** estes mutantes. Mutante sobrevivente
= teste fraco → **reforçar o teste**, nunca afrouxar o código.

| Mutação | Onde | Teste que deve matar |
|---|---|---|
| `approved !== true` → `approved === false` (aceitar `false`) | AC1 | Caso `approved: false` → 400 |
| `approved === true` → `!approved` (aceitar omitido) | AC1 | Caso body sem `approved` → 400 |
| `status: 'applied'` → `'drafted'` | AC1 | Assert do `status` final |
| `appliedAt` ISO → `null` | AC1 | Assert `appliedAt` não-nulo após confirmar |
| `appliedEmails.slice(0,10)` → `slice(0,9)` | AC1 | Fixture com exatamente 10 e-mails |
| `applyNote.slice(0,500)` → `slice(0,499)` | AC1 | Nota no limite (500) |
| histórico `[user, assistant]` → ordem trocada | CH1 | Assert ordem user→assistant |
| gate "sem contexto" `409` → condição invertida | CH1 | Caso sem snapshot/fit → 409 |
| remover instrução zero-mentira do prompt | CH1 | Assert de substring do grounding no system prompt |
| `message.trim().min(1)` → aceitar vazio | CH1 | Caso mensagem só espaços → 400 |
| `history.slice(-N)` → `slice(0,N)` | CH1 | Fixture com mais mensagens que o limite |

## 12. Test plan

- **Backend (Vitest, Node):** `pnpm test` — suíte atual + `test/apply-confirm.test.ts`,
  `test/chat.test.ts` (+ roundtrip do repositório).
- **Frontend (Vitest, jsdom):** `pnpm test:web` — `JobApplyActions.test.tsx`,
  `JobApplyConfirm.test.tsx`, `JobChat.test.tsx`.
- **Sem Chromium real:** prefill/perguntas já usam `applyBrowser` stub no backend; os testes de
  UI mockam hooks/api (F1).
- **Sem rede/LLM real:** `createLlmClient` mock; assert de contagem de chamadas (chat = 1 por
  mensagem) e de ausência de key (F7).
- **Fixtures:** vaga raspada (`jobSnapshot.content`), fit (rating/dimensões/gaps), mensagens de
  chat.
- **Comandos focados:**

```bash
pnpm test -- test/apply-confirm.test.ts
pnpm test -- test/chat.test.ts
pnpm test:web -- JobApplyActions JobApplyConfirm JobChat
```

- **Gate completo (antes de cada entrega):**

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web
pnpm build:web
```

## 13. Acceptance criteria

- [x] Apply-confirm v2-nativo + shim de compat funcionando; `approved: true` obrigatório;
      `status='applied'` com `appliedAt`/`applyNote`/`applyMethod`/`channel`/`appliedEmails`.
- [x] Botões de prefill (dry-run) e extração de perguntas no React, com resultado e erros.
- [x] Chat pós-resposta: chat livre + ações rápidas, síncrono, com contexto (vaga + fit) e
      grounding zero-mentira; histórico persistido por vaga.
- [x] Chave de LLM nunca exposta no chat; nenhum SQL aplicado (`0000–0003`) editado.
- [x] `pnpm typecheck && pnpm test && pnpm typecheck:web && pnpm test:web && pnpm build:web`
      verdes, 0 regressões (baseline 302 backend / 43 frontend).
- [x] Docs + ADR-0011; itens do backlog do roadmap §1 (botões de prefill/perguntas) riscados.

## Execution status

The executor marks each item as it completes. One checkbox per task.

- [x] X1 — migrations `0004_apply_confirm` + `0005_job_chat`, `schema.ts`, `domain/job.ts`,
      `web/src/api/types.ts` — done: `drizzle-kit generate` produced `0004_apply_confirm.sql`
      (`apply_note`, `apply_method DEFAULT 'manual' NOT NULL`) and `0005_job_chat.sql`
      (`chat_history`); `0000`–`0003` untouched. Evidence: `pnpm typecheck` exit 0 and
      `pnpm typecheck:web` exit 0. commit: 938e79b
- [x] X2 — mappers + `JobRepository` (`applyNote`/`applyMethod`/`chatHistory`) — done:
      `pnpm test -- test/repositories.test.ts` green (303 tests, incl. the new roundtrip
      "persiste os campos do apply-confirm e o histórico de chat" and the updated defaults).
      commit: 938e79b
- [x] AC1 — `src/pipeline/apply/confirm.ts` + `POST /api/jobs/:id/apply-confirm` — done:
      `pnpm test test/apply-confirm.test.ts` green (10 tests: 404, 400 without/with false
      approval, happy path, sanitized channel/note/e-mails, 10 e-mail cap, 500-char note,
      `portal` fallback).
- [x] CH1 — `src/pipeline/chat.ts` + `PipelineService.chat` + `POST /api/jobs/:id/chat` — done:
      `pnpm test test/chat.test.ts` green (12 tests: 404, 400 blank message, 409 without
      context, user→assistant order, grounding on posting + fit + history, prompt history
      window, redacted provider failure, route shapes).
- [x] PQ1 — client/hooks/`ApplyActions` (prefill + perguntas) in `JobDetail` — done:
      `pnpm test:web JobApplyActions` green (4 tests: both buttons, disabled without URL/kit,
      prefill report links, question summary, 400 surface).
- [x] AC2 — "Marcar como aplicada" UI + `useApplyConfirm` — done:
      `pnpm test:web JobApplyConfirm` green (2 tests: form sends `approved: true` + fields and
      refetches the job; API 400 surfaced).
- [x] CH2 — `ChatPanel` + `useChat` in `JobDetail` — done:
      `pnpm test:web JobChat` green (4 tests: persisted thread, free message, quick-action
      prompt, 409 surface).
- [x] AC3 — shim `POST /api/applications/:id/apply-confirm` — done: `pnpm test
      test/apply-confirm.test.ts` green, including the legacy `{ success, application }`
      shape writing the same `jobs` columns (commit follows).
- [x] X3 — docs + ADR-0011 — done: `docs/api.md` (new `apply-confirm` + `chat` payloads and
      the legacy shim), `docs/architecture.md` (sync chat path), `docs/data-model.md`
      (`apply_note`/`apply_method`/`chat_history`), `docs/frontend.md` (ApplyActions,
      ApplyConfirm, ChatPanel), `docs/roadmap.md` (Phase 4 + struck backlog item),
      `docs/README.md` and `docs/adr/README.md` (indexed the new phase and ADR-0011).
- [x] X4 — gate completo — done: `pnpm typecheck` (exit 0), `pnpm test` (31 files / 325 tests),
      `pnpm typecheck:web` (exit 0), `pnpm test:web` (11 files / 53 tests),
      `pnpm build:web` (109 modules, built in 1.55 s). Baseline 302/43 → 325/53, 0 regressões.
      Closing docs commit: e82b2df.

## Close-out

All tasks X1–X4 and AC1–AC3 delivered. Commits: 938e79b (schema/repository), 3bae4d4
(apply-confirm + chat API), 8f6f85a (React surface), e82b2df (docs + ADR-0011 + this plan).
Gate evidence recorded above; nothing is left blocked.

Left out of the commit deliberately: the uncommitted deletions of
`.plans/2026-11-14-pipeline-port/plan.md`, `.plans/pipeline-port-review.md` and
`.plans/pipeline-port-v1-v2.md`. They are historical records referenced by this plan's header,
so they stay untouched until the user confirms the cleanup.
