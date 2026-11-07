# Plano — Portar o pipeline pesado (v1 → v2)

> Status: **não iniciado**. Este registro guarda o contexto histórico que foi removido do
> `AGENTS.md` (que deve conter apenas regras de desenvolvimento do projeto atual).

## O que existe apenas no v1

- Rotas de processamento pesado: `POST /api/process-job`, `POST /api/fit-check`.
- Upload de currículo base com extração de PDF e regeneração de kit
  (`/api/applications/:id/regenerate`).
- Checkpoints interativos / fila de perguntas (`/api/processes/:id/question`, `/respond`).
- Stack completa de Playwright + LLM + geração de PDF.

## O que no v2 depende desse port

- Responder checkpoint dentro do v2 (fase 2 incompleta).
- Upload/extração de PDF no admin; hoje o admin edita apenas texto
  (`.txt`/`.md`/`.html` ou colado).
- Consumo de `profiles.enabled` e `profiles.extra_prompt` pelo pipeline (fase 3).
  Ver `app-settings-alvos.md`.

## Notas

- O v1 continua funcional na porta `3333` como referência e fallback.
- Estratégia strangler: as rotas de compatibilidade (`/api/applications`, `/api/processes`)
  não podem ser removidas até a UI antiga ser aposentada.
- Detalhes de arquitetura em `docs/architecture.md`, `docs/roadmap.md` e ADR-0004.
