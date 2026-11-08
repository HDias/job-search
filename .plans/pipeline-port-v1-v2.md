# Plano — Portar o pipeline pesado (v1 → v2)

> Mapa de arquitetura obtido por leitura integral de `server.mjs`, `job_processor.mjs`,
> `llm_client.mjs`, `skill_loader.mjs`, `src/fit/**`, `scripts/analyze_profile.mjs` e dos assets
> da skill do projeto anterior.

> **Revisão (2026-11-07):** ver
> [`pipeline-port-review.md`](./pipeline-port-review.md) para as lacunas encontradas e as
> decisões de reconciliação (vocabulário de estágios de `runs`, migração `0003`, destino de
> `/api/evaluate-fit`, `scrape_application_questions.mjs` e `extractCandidateFromBase`).

## 1. O que existe no v1 e precisa ser portado

| Bloco | Origem (v1) | Destino (v2) |
|---|---|---|
| Cliente LLM (Gemini/OpenAI/NVIDIA/Anthropic + retry/backoff) | `llm_client.mjs` | `src/pipeline/llm/client.ts` |
| Config de LLM (`base_profile/config.json`, key plaintext) | `getLlmConfig`/`saveLlmConfig` + rotas `/api/llm-config` | tabela `settings` (`llm_config`) + rotas em `/api` com key mascarada |
| System prompts vivos da skill | `skill_loader.mjs` + assets da skill | `src/pipeline/skills/loader.ts` + assets em `skills/` no v2 |
| Scrape de vaga (Playwright + atalho Greenhouse API) | `scripts/scrape_job.mjs` na skill anterior | `src/pipeline/scrape/job.mjs`-equivalente TS (Fase 2) |
| Fit híbrido determinístico | `src/fit/**` + `scripts/analyze_profile.mjs` | `src/pipeline/fit/**` (Fase 2) |
| Fit por LLM (`checkJobFit`), language gate, thin content | `job_processor.mjs:516–694` | `src/pipeline/kit/fit.ts` (Fase 2) |
| Geração do kit (prompt gigante, `needs_input`, validator retry) | `job_processor.mjs:701–1124` | `src/pipeline/kit/generate.ts` (Fase 3) |
| Escrita de artefatos + PDF (Playwright) + `pdftotext` ATS layer | `job_processor.mjs` + `generate_pdf.mjs` | `src/pipeline/kit/artifacts.ts` + `src/pipeline/pdf.ts` (Fase 3) |
| Sugestões de respostas determinísticas | `question_suggestion_engine.mjs` | `src/pipeline/kit/suggestions.ts` (Fase 3) |
| Fila interativa (question/respond, rounds ≤ 2, replay sem LLM) | `server.mjs:1010–1190` | estágios de `runs` + endpoints v2 (Fase 4) |
| Regenerar kit | `server.mjs:1193–1358` | `POST /api/jobs/:id/regenerate` (Fase 4) |
| Upload de currículo com extração de PDF (`multer` + `pdftotext`) | `server.mjs:638–682` | `POST /api/profiles/:stack/:language/upload` (Fase 5) |
| Pre-fill dry-run (Playwright, nunca clica Submit) | `apply_assistant.mjs` | Fase 5+ (opcional/última) |
| Respostas de checkpoint na UI | `public/index.html` | React em `JobDetail` (Fase 5) |

## 2. Decisões de arquitetura do port

- **D1 — Módulo próprio**: todo código de pipeline vive em `src/pipeline/`; só fala com o mundo
  via `Store` (repositórios), `config.ts` e funções injetadas (`fetch`, `sleep`, browser).
  Nada de `fs` de estado: checkpoints são `runs`, artefatos são linhas em `artifacts`.
- **D2 — Modelo assíncrono**: no v1, `process-job`/`fit-check` são requests longos e síncronos
  (LLM + até 3 Chromium dentro do request). No v2, os endpoints nativos devolvem **`202 {runId}`**
  e um worker **in-process FIFO (1 execução por vez)** faz o trabalho; a UI já polla
  `/api/jobs/:id` a cada 4 s enquanto há run ativo. As rotas de compatibilidade não mudam.
- **D3 — Assets da skill versionados no v2**: `SKILL.md`, `references/` e `templates/` são copiados
  para `skills/job-application-tailor/` e `skills/resume-pdf-renderer/` (scripts **não** são
  copiados — são portados para TS nas suas fases). `SKILLS_DIR` sobrescreve; default `skills/`.
  O v1 permanece intocado.
- **D4 — Config de LLM na tabela `settings`** (chave `llm_config`), nunca exposta pela API:
  `GET /api/llm-config` devolve só `hasKey` + `maskedKey` (formato v1: `abc123...wxyz`).
  A chave vive **exclusivamente no DB** — não é necessário configurar env. O `GEMINI_API_KEY`
  legado permanece apenas como fallback opcional (não requerido). Nunca logar o objeto de
  config nem a key; `PUT`/`POST` com semântica parcial (ausente preserva; `apiKey: ''` preserva —
  paridade com o POST do v1).
- **D5 — Consumo dos alvos configuráveis**: o pipeline só usa
  `profiles` com `enabled = true` e injeta `extraPrompt` nos system prompts de fit e tailor via
  `withExtraPrompt` (`src/pipeline/prompts.ts`). Texto extra é instrução de estilo, nunca fato.
- **D6 — Invariantes preservados**: replay de pergunta sem nova chamada LLM quando o run já está
  `needs_input` e não veio resposta; whitelist de inferências aprovadas (só as oferecidas pelo
  LLM, `confidence: high`, sem numéricas); máx. 2 rodadas de `needs_input`; `clarificationHistory`
  com as últimas 2.
- **D7 — Estágios de `run`** (coluna `stage` já existe): `queued` → `scraping` → `scrape-thin` |
  `fit-checked` → `generating` ⇄ `needs_input` → `done` | `failed`. `error` guarda a mensagem;
  runs `failed`/`needs_input` são retomáveis ("continuar de onde parou"). **Alinhar
  `src/domain/run.ts` na Fase 2** — hoje ele usa `draft`/`processing`/`awaiting-*`/`error`, que não
  batem com a UI antiga nem com o DTO de compat.
- **D8 — Endpoints v2-nativos** (REST novo, não nas rotas de compat):
  - `POST /api/fit-check` → `202 {runId}`
  - `POST /api/generate-kit` → `202 {runId}` (equivalente ao `process-job`)
  - `GET /api/runs/:id/question` / `POST /api/runs/:id/respond` → fila interativa
  - `POST /api/jobs/:id/regenerate` → `202 {runId}`
  - `POST /api/profiles/:stack/:language/upload` → multipart (`multer`), extração `pdftotext`
- **D9 — Dependências novas por fase**: Fase 1 não adiciona nada; **Fase 2** adiciona
  `playwright`; **Fase 5** adiciona `multer` (e `@types/multer`); `pdftotext` segue dependência
  de sistema (poppler-utils). O browser do Playwright é **reutilizado por worker da fila**
  (não abre/fecha por PDF), injetável (`browserFactory`) para testes.
- **D10 — Slug/candidato**: `getCandidateFileSlug` lê `settings.candidate_form` (já existe no v2),
  com fallback `Horecio-Dias`; tema de PDF vem de `settings.pdf_theme` (centraliza as 3 leituras
  duplicadas do v1).

## 3. Estado por fase

Legenda: `[x]` feito · `[ ]` pendente · `[~]` parcial.

### Fase 1 — Fundação (LLM + skills + contrato de prompt) ✅

- [x] `src/domain/llm.ts`: `LLM_PROVIDERS`, `LlmConfig`, `llmConfigPatchSchema` (Zod),
      `DEFAULT_MODEL_BY_PROVIDER`, `maskApiKey`, `toPublicLlmConfig`.
- [x] `src/pipeline/llm/config.ts`: carregar/salvar `settings['llm_config']` com merge parcial
      (`undefined` preserva, `null` limpa, `apiKey: ''` preserva como no v1) e fallback
      `GEMINI_API_KEY`.
- [x] `src/pipeline/llm/client.ts`: `createLlmClient({ settings, fetchImpl?, sleep? })` com
      `call(prompt, system, { maxRetries })`; retry/backoff `2s/6s/12s` em 429/5xx/transientes;
      dispatch gemini/openai-family (aliases DeepSeek, sampling por família, `baseUrl` custom,
      content array NVIDIA)/anthropic. Paridade com `llm_client.mjs`.
- [x] `src/pipeline/skills/loader.ts`: `createSkillLoader(skillsDir)` com cache, `safeRead`,
      `buildFitSystemPrompt`, `buildTailorSystemPrompt`, `buildEmailSection`, `readTemplate`.
- [x] `src/pipeline/prompts.ts`: `resolveTargetProfile` (só `enabled`), `withExtraPrompt` e
      `targetSystemPrompts` (contrato da seção 6 de `app-settings-alvos.md`).
- [x] Assets: `skills/job-application-tailor/{SKILL.md,references,templates}` e
      `skills/resume-pdf-renderer/{SKILL.md,references,templates}` copiados do v1 (v1 intocado).
- [x] `src/config.ts`: `skillsDir` (`SKILLS_DIR`).
- [x] `src/api/routes/meta.ts`: `GET /api/llm-config` (mascarado) + `PUT`/`POST` (POST é alias
      para o UI do v1). Respostas no formato do v1 (`{success, message}` / objeto mascarado).
- [x] Testes: `test/llm-client.test.ts`, `test/pipeline-prompts.test.ts`, `test/llm-config.test.ts`.
- [x] Docs: `docs/api.md` (llm-config + formato), este plano.
- [x] Gates: `pnpm typecheck && pnpm test`.

### Fase 2 — Scrape + fit-check

- [ ] **Pré-requisitos**: `pnpm add playwright`; gerar a migração `0003_pipeline_runs.sql`
      (ver `pipeline-port-review.md` §4) e reconciliar `src/domain/run.ts` (D7) +
      `web/src/api/types.ts` + `src/api/dto/legacy.ts`.
- [ ] `src/pipeline/scrape/job.ts`: port de `scrape_job.mjs` (Greenhouse API-first via `fetch`,
      senão Chromium headless; args UA/viewport/locale; waits e timeouts idênticos; retorno
      `{url, scrapedAt, title, company, location, applyUrl, detectedLanguage, languageConfidence, content}`).
      Browser injetável (`chromium` da lib ou stub em testes).
- [ ] `src/pipeline/content.ts`: `isJobContentThin`, `detectLangFromText`,
      `hasExplicitLanguageRequirement` (regex do v1), `detectLogisticsNote`
      (`job_processor.mjs:203`), truncations (12000/6000).
- [ ] `src/pipeline/fit/**`: port de `src/fit` (semântico/temporal/evidência) +
      `analyze_profile.mjs` coberto por testes dos `scripts/*.test.mjs` do v1; **não** portar
      `calculateFitHybridSync` (está quebrado no v1 — missing import).
- [ ] `src/pipeline/kit/fit.ts`: `checkJobFit` (LLM call com `buildFitSystemPrompt` +
      `withExtraPrompt` do alvo; envelope do fit no schema da skill; gate de elegibilidade;
      sugestão de idioma).
- [ ] `POST /api/evaluate-fit` (D12): fit híbrido determinístico síncrono (sem fila), lê
      `profiles` PT/EN + texto da vaga; mantém o alias "Retry fit" do v1, separado do fit por LLM.
- [ ] `POST /api/fit-check` v2: valida body, cria `run` `queued`, fila executa; `scrape-thin`
      persistido como no v1 (sem chamada de LLM quando conteúdo raso).
- [ ] Fila: `src/pipeline/queue.ts` (FIFO, 1 slot, erros → `failed` com `error` e `resumable`);
      um browser/contexto Playwright reutilizado por worker (injetável para testes).
- [ ] Testes com `fetchImpl`/`browserFactory` stub (sem lançar Chromium): fit-check feliz,
      thin content, gate de idioma, retry de run falho.

### Fase 3 — Geração do kit + PDF

- [ ] `src/pipeline/kit/generate.ts`: port do monolito `processJob` (:701–1124) em passos puros:
      `resolveJobData`, load do currículo do **alvo** (`profiles.content.rawText`; fallback por
      idioma/stack como no v1), pre-pass determinístico (`extractCoverageTerms`, ammo,
      approved-fit, clarifications), prompt do kit (com `buildTailorSystemPrompt` +
      `withExtraPrompt`), `parseKitOrQuestion` tolerante, validator retry (máx. 2 fix-prompts).
- [ ] `src/pipeline/kit/slug.ts`: `getCandidateFileSlug` (D10), `sanitizeName` e
      `shortRoleFileSlug` (nomes de pasta de artefato).
- [ ] `src/pipeline/kit/validate.ts`: port de `validate_resume_html` + `validateResumeContent`
      (coverage/hallucination/cliché/ammo/acento) usando `settings['pdf_theme']` centralizado.
- [ ] `src/pipeline/pdf.ts`: `generatePdf` (Chromium `page.pdf` A4 15mm printBackground,
      browser injetado/reutilizado — D9) + `pdftotext -layout` → `_ats_layer.txt` +
      `atsCompatible`; port de `buildCombinedCvWithCoverHtml` (capa primeiro após `.accent`,
      acento único) e `detectCoverLetterInCvRequirement`.
- [ ] `src/pipeline/kit/artifacts.ts`: pasta `applications/<company>_<role>[_N]`, grava
      `job_posting.md`, `fit_check.json`, HTML/PDF, e-mails/mensagens,
      `application_questions.json`, `materiais_extras/sugestoes_respostas.{json,md}` +
      `README.md` (renderização que no v1 vive em `generate_question_suggestions.mjs`); registra
      no repositório `artifacts` (caminho relativo + mime + size) e atualiza o `job` (fit, arquivos).
- [ ] `src/pipeline/kit/suggestions.ts`: port de `question_suggestion_engine.mjs` (determinístico).
- [ ] Testes: port dos 3 `node --test` do v1 para Vitest (`coverage`, `thin-content`,
      `cover-in-cv`) usando fixtures.
- [ ] Notas: `parse_resume.mjs` já coberto pela Fase 5 (upload → `profiles.content`); o
      `render_pdf.mjs` do v1 (contagem de páginas) é cosmético e pode ser ignorado.

### Fase 4 — Fila interativa + regenerar

- [ ] **Migração já aplicada na Fase 2** (`0003_pipeline_runs.sql`, ver
      `pipeline-port-review.md` §4): aqui só consumir `llm_question`, `needs_input_rounds`,
      `clarification_history`, `cover_letter_guidance` e `include_cover_in_cv`.
- [ ] `POST /api/generate-kit` (process-job): gates 409 (idioma não explícito, fit<50/eligibility
      sem `fitConfirmed`, idioma divergente do requerido), replay de `needs_input` sem LLM,
      roda de `generating`, transição para `done` (com `jobId`/application) ou `needs_input`
      (rounds ≤ 2), `failed` resumável.
- [ ] `GET /api/runs/:id/question` + `POST /api/runs/:id/respond`: validação de resposta
      (400 se `missing_fact` vazia; 400 se aprovação de inferência não oferecida), append de
      `clarificationHistory` (últimas 2, 2000 chars), retomada do mesmo ponto.
- [ ] `POST /api/jobs/:id/regenerate`: re-scrape ou reaproveita `job_posting.md` do diretório,
      reconstrói language gate, preserva `id/date/status/createdAt`, leva `questions` +
      `mensagem_recrutador_origem.txt` do diretório antigo, copia extras faltantes.
- [ ] Compat: `/api/processes/:id` PATCH continua escrevendo nos mesmos campos de `runs`;
      adicionar shims `/api/processes/:id/question` e `/api/processes/:id/respond` delegando aos
      equivalentes de `runs` (checkpoints v1 UI não quebram).
- [ ] Testes de requisição cobrindo todos os gates 409/400 e retomadas.

### Fase 5 — Upload, UI de checkpoint e polimento

- [ ] `pnpm add multer` + `pnpm add -D @types/multer` (o `playwright` já entrou na Fase 2);
      `pnpm-workspace.yaml` `allowBuilds` já cobre better-sqlite3.
- [ ] `POST /api/profiles/:stack/:language/upload`: multipart 10 MB, `pdftotext` para PDF, grava
      `profiles.content = {sourceFile, language, stack, extractedAt, rawLength, rawText}`.
- [ ] React: responder checkpoint no `JobDetail` (pergunta + opções + aprovar/rejeitar
      inferências), disparar fit-check/geração (formulário existe? criar entrypoint discreto),
      painel de LLM config no Admin (com key mascarada).
- [ ] Pre-fill dry-run (opcional, última fatia): port de `apply_assistant.mjs` mantendo o
      contrato "nunca clica Submit"; opcionalmente portar `scrape_application_questions.mjs`
      (D11) na mesma fatia de preenchimento assistido.
- [ ] `candidate-data` GET: portar `extractCandidateFromBase()` (`server.mjs:106–159`) para
      auto-extrair nome/e-mail/telefone/LinkedIn/GitHub de `profiles.content.rawText` (hoje o
      v2 só devolve `settings.candidate_form`).
- [ ] Docs: `docs/api.md`, `docs/frontend.md`, `docs/architecture.md` (remove "não roda
      Playwright/LLM"), roadmap Fase 2/3, ADR-0010 (pipeline assíncrono no v2).
- [ ] Critério final: v1 UI pode ser aposentada (roadmap §3 último item).

## 4. Notas

- O v1 continua funcional na porta `3333` como referência e fallback até a Fase 5 terminar.
- Estratégia strangler: rotas de compatibilidade (`/api/applications`, `/api/processes`) não
  podem ser removidas até a UI antiga ser aposentada.
- Armadilhas registradas no mapa do v1:
  1. `upsertProcess`/`saveApplications` do v1 são read-modify-write de arquivo inteiro — no v2
     tudo passa por transações do repositório.
  2. `getPdfTheme` duplicado em 3 lugares no v1 — no v2 uma leitura (`settings`).
  3. `calculateFitHybridSync` está quebrado no v1 (import ausente) — não portar.
  4. O motor híbrido **não** é usado no caminho principal do fit (só `/api/evaluate-fit` /
     "Retry fit") — manter essa separação.
  5. Requests síncronos longos no v1 → modelo assíncrono no v2 (D2); UI já polla runs ativos.
  6. `config.json` do v1 guarda a API key em plaintext — o import nunca trouxe keys, e o v2
     mantém a key fora das respostas (`maskedKey`).

## 5. Verificação

```bash
pnpm typecheck && pnpm test
pnpm typecheck:web && pnpm test:web   # a partir da Fase 5
pnpm build:web                        # a partir da Fase 5
```

Focados:

```bash
pnpm test -- test/llm-client.test.ts
pnpm test -- test/llm-config.test.ts
pnpm test -- test/pipeline-prompts.test.ts
```
