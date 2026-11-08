# Revisão do plano — port do pipeline v1 → v2

> Complemento de [`pipeline-port-v1-v2.md`](./pipeline-port-v1-v2.md). Foi produzido por
> leitura integral de `server.mjs`, `job_processor.mjs`, `src/fit/**` e dos scripts em
> `.agents/skills/**` do v1, comparados com o estado atual do v2 (`src/domain/`,
> `src/db/schema.ts`, `src/api/`, `src/pipeline/`). Consolida a revisão de lacunas e as
> decisões de reconciliação tomadas antes de começar a Fase 2.

## 1. Veredito

- A **Fase 1 está fiel ao código**: `src/pipeline/{llm,skills,prompts}`, rotas de
  `llm-config` e assets das skills batem com o que existe no disco.
- O plano cobre o caminho principal (`checkJobFit` → `processJob` → artefatos), mas tem
  **1 migração ausente**, **1 endpoint sem destino**, **2 fonts v1 não mencionadas** e uma
  **divergência de vocabulário de estágios** com o código atual do v2.
- Fases 2–4 seguem válidas; os deltas estão na seção 5.

## 2. Decisões de escopo

### D11 — `scrape_application_questions.mjs` fica fora do pipeline (Fase 5, opcional)

No v1 esse script é **CLI standalone** (Greenhouse/Lever/Workable/genérico →
`application_questions.json`). Ele **não** é chamado por `processJob`; a única fonte
automática de `application_questions.json` é o campo `extraQuestions` (manual). Portanto
não entra no port do pipeline. Fica opcional na Fase 5, na mesma fatia de
`apply_assistant.mjs` ("preenchimento assistido"), caso se queira automatizar a extração
de perguntas do formulário.

### D12 — `POST /api/evaluate-fit` (fit híbrido) é Fase 2, síncrono

O motor híbrido (`calculateFitHybrid`, async, `src/fit/index.js`) é determinístico e **não
usa LLM**, então não passa pela fila 202. Só `calculateFitHybridSync` está quebrado no v1
(chama `calculateSemanticFitSync`, que não existe) — esse sim **não** se porta.

- Portar `src/fit/**` + `scripts/analyze_profile.mjs` na Fase 2.
- Expor `POST /api/evaluate-fit` (alias "Retry fit") que lê `profiles` (PT/EN) e o texto da
  vaga e devolve o breakdown híbrido — mantendo a separação em relação ao fit por LLM.

### D13 — Chave de LLM só no DB, nunca exposta

A chave vive **exclusivamente** em `settings['llm_config']`; **não** é necessário configurar
env. `GEMINI_API_KEY` fica apenas como fallback opcional legado (`loadLlmConfig`), não
requerido. Regras:

- `GET /api/llm-config` devolve só `hasKey` + `maskedKey` (já implementado em
  `toPublicLlmConfig`); nunca a key em claro.
- Nunca logar o objeto de config (`console.log(config)`/`JSON.stringify(settings)`) nem deixar
  a key vazar em `error.message` de provider.
- O v1 guarda a key em texto puro em `base_profile/config.json`. Migrar para o DB e depois
  rotacionar/limpar esse arquivo (vetor de vazamento).
- Opcional: cifrar o valor em repouso (AES com chave local) — o SQLite já fica fora do git.

## 3. Reconciliação de estágios (`runs.stage`)

O `src/domain/run.ts` atual foi escrito **antes** do port e usa estágios que não batem com
o v1. Como `toLegacyProcess` repassa `run.stage` **verbatim** para a UI antiga, e a UI
antiga só entende os nomes do v1, adotar o vocabulário v1 + os estágios do modelo async:

```
queued → scraping → scrape-thin → fit-checked → generating ⇄ needs_input → done | failed
```

| Estágio atual no v2 | Destino |
|---|---|
| `draft` | Aposentar; `queued` vira o estado inicial |
| `processing` | → `generating` (nome do v1) |
| `awaiting-language` | Aposentar — já representado por `needsLanguageConfirmation` + `fit-checked` (v1 usa 409, não estágio) |
| `awaiting-fit` | Aposentar — já representado por `needsFitConfirmation` |
| `error` | → `failed` (nome do v1) |

## 4. Migração `0003_pipeline_runs.sql`

A tabela `runs` não tem os campos que a fila interativa exige. A migração entra **no início da
Fase 2** (a Fase 2 já persiste `scrape-thin`/`fit-checked`; a Fase 3 já lê
`cover_letter_guidance`/`include_cover_in_cv` no resume da fila), não na Fase 4. Criar a
migração:

```sql
ALTER TABLE runs ADD COLUMN llm_question TEXT;            -- JSON {question,options,blockingField,kind,inferences,rawExcerpt}
ALTER TABLE runs ADD COLUMN needs_input_rounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN clarification_history TEXT;   -- JSON [{answer,approvedInferences,rejectedInferences,at}] (últimas 2)
ALTER TABLE runs ADD COLUMN cover_letter_guidance TEXT;
ALTER TABLE runs ADD COLUMN include_cover_in_cv TEXT;     -- 'auto' | 'true' | 'false' | 'never' | 'force'
```

Gerar com `pnpm exec drizzle-kit generate --name=pipeline_runs` (nunca editar SQL já
aplicado) e ajustar em conjunto:

- `src/db/schema.ts`: novas colunas em `runs`.
- `src/domain/run.ts`: `RUN_STAGES` (seção 3) + campos `llmQuestion`, `needsInputRounds`,
  `clarificationHistory`, `coverLetterGuidance`, `includeCoverInCv` em `Run` e nos
  schemas `newRunBaseSchema`/`runPatchSchema`.
- `web/src/api/types.ts`: espelhar os campos novos em `Run` (convenção do repo: os dois
  lados do domínio mudam juntos).
- `src/api/dto/legacy.ts`: `toLegacyProcess`/`legacyProcessPatch` para fazer
  `question`/`respond` da UI antiga sobreviverem (`llmQuestion`, `clarificationHistory`).

## 5. Deltas por fase

### Fase 2 — Scrape + fit-check

- [ ] **Pré-requisitos**: `pnpm add playwright`; migração `0003_pipeline_runs.sql` (seção 4) +
      reconciliação de `src/domain/run.ts` (seção 3), `web/src/api/types.ts` e
      `src/api/dto/legacy.ts`.
- [ ] `src/pipeline/content.ts` passa a incluir também `detectLogisticsNote`
      (`job_processor.mjs:203`), hoje sem destino no plano.
- [ ] `src/pipeline/fit/**` + `scripts/analyze_profile.mjs` (como já previsto).
- [ ] `POST /api/evaluate-fit` síncrono (D12).
- [ ] `POST /api/fit-check` → `202 {runId}` + `src/pipeline/queue.ts` (FIFO, 1 slot), com um
      browser/contexto Playwright reutilizado por worker.
- [ ] Testes com `fetchImpl`/`browserFactory` stub — nunca lançar Chromium na suíte.

### Fase 3 — Geração do kit + PDF

- [ ] `src/pipeline/kit/slug.ts` com `getCandidateFileSlug` (D10), `sanitizeName` e
      `shortRoleFileSlug` (hoje só implícitos em `artifacts.ts`).
- [ ] `artifacts.ts` assume explicitamente a renderização de
      `materiais_extras/sugestoes_respostas.md` e `README.md` (lógica que no v1 vive em
      `generate_question_suggestions.mjs`, não no engine).
- [ ] `parse_resume.mjs` já está coberto pela Fase 5 (upload → `profiles.content`), shape de
      saída idêntico — sem ação extra.
- [ ] `render_pdf.mjs` (contagem de páginas) pode ser ignorado — é wrapper cosmético.

### Fase 4 — Fila interativa + regenerar

- [ ] **Migração já aplicada na Fase 2** (`0003_pipeline_runs.sql`, seção 4): aqui só consumir
      `llm_question`, `needs_input_rounds`, `clarification_history`, `cover_letter_guidance` e
      `include_cover_in_cv`.
- [ ] `GET/POST /api/runs/:id/{question,respond}` (como previsto).
- [ ] Compat: adicionar shims `/api/processes/:id/question` e `/api/processes/:id/respond`
      delegando aos equivalentes de `runs`, até a UI React assumir os checkpoints.

### Fase 5 — Upload, UI e polimento

- [ ] Opcional: portar `scrape_application_questions.mjs` na fatia de preenchimento
      assistido (D11).
- [ ] `meta.ts` `candidate-data` GET deve portar `extractCandidateFromBase()`
      (`server.mjs:106–159`) — regex de nome/e-mail/telefone/LinkedIn/GitHub a partir de
      `profiles.content.rawText`; hoje o v2 só devolve `settings.candidate_form`.
- [ ] Observação: as rotas de metadados de Admin (`llm-config`, `pdf-theme`,
      `candidate-data`, `profiles`, `base-resumes`) **já existem** em `src/api/routes/meta.ts`
      — falta só a tela React.

## 6. Itens menores (disposição)

| # | Item v1 | Disposição |
|---|---|---|
| G2 | `generate_question_suggestions.mjs` (markdown/README) | `artifacts.ts` (Fase 3) |
| G3 | `render_pdf.mjs` (page count) | Ignorar (cosmético) |
| G4 | `extractCandidateFromBase()` | `meta.ts` `candidate-data` (Fase 5) |
| G5 | `detectLogisticsNote` | `content.ts` (Fase 2) |
| G6 | `sanitizeName` / `shortRoleFileSlug` | `kit/slug.ts` (Fase 3) |
| G8 | `/api/processes/:id/question`+`respond` | Shims de compat (Fase 4) |
| G9 | `/api/skill-info` + `loadSkillReferences` | Opcional/painel de transparência; não é paridade obrigatória |

## 7. Verificação

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # a partir da Fase 2 (web/src/api/types.ts muda junto)
pnpm build:web                        # a partir da Fase 2
```

Focados:

```bash
pnpm test -- test/llm-client.test.ts
pnpm test -- test/llm-config.test.ts
pnpm test -- test/pipeline-prompts.test.ts
```
