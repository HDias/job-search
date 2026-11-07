# ADR-0009 — Alvos configuráveis em `profiles`

- **Status:** Aceita
- **Data:** 2026-11-07

## Contexto

A UI do v1 assumia exatamente quatro currículos base fixos (`pt-br`, `en`, `php-pt-br`,
`php-en`), derivados de duas stacks (Ruby e PHP) e dois idiomas. O v2 precisava permitir novas
combinações sem alterar o schema a cada stack e, ao mesmo tempo, guardar instruções de prompt por
alvo para o pipeline futuro.

Era necessário decidir onde modelar "alvo" e como remover/desativar sem perder o currículo.

## Decisão

- **Alvo = uma linha em `profiles`**, identificada pela chave composta `(stack, language)`.
  Não existe tabela separada de alvos.
- `stack` é um slug livre (`^[a-z][a-z0-9-]{0,31}$`); `language` continua limitado ao enum
  `LANGUAGES` (`pt-br`, `en`).
- A tabela ganhou duas colunas aditivas:
  - `enabled` (`INTEGER` boolean, default `true`): o pipeline futuro considera só alvos ativos.
  - `extra_prompt` (`TEXT`, nullable): instruções de estilo/ênfase anexadas aos prompts de fit e
    tailor. **Não é fonte de fatos**; o grounding continua no currículo base.
- A API expõe `GET/POST/PUT/DELETE /api/profiles`, com `PUT` parcial (campos ausentes preservados)
  e `409` em criação duplicada.
- Remover um alvo apaga a linha e o currículo salvo. A alternativa não destrutiva é
  `enabled = false`.
- `/api/base-resumes` permanece com o formato legado de quatro chaves para o v1; a UI nova usa
  `/api/profiles`.
- O consumo de `extraPrompt` pelo pipeline fica para a Fase 3.

## Consequências

**Positivas**

- Adicionar uma stack é só criar uma linha; nenhuma migration nova.
- O modelo document-shaped é preservado: o currículo continua em `content`, sem normalização
  excessiva.
- Desativar e remover têm semânticas distintas e explícitas na UI.
- Os quatro alvos importados do v1 continuam ativos por causa do default `enabled = true`.

**Negativas**

- `stack` livre exige validação na borda (Zod + slug) e não impede stacks "válidas mas erradas".
- O idioma natural continua restrito a `pt-br`/`en`; adicionar `es`/`fr` exige estender
  `LANGUAGES`, o language gate e a UI.
- Remover é destrutivo para o currículo; a UI confirma, mas não há lixeira ou soft delete.
- O pipeline ainda não lê `enabled`/`extraPrompt`; até a Fase 3 o efeito é apenas de configuração.

## Referências

- [api.md](../api.md) — endpoints de `profiles`
- [data-model.md](../data-model.md) — colunas `enabled` e `extra_prompt`
- [frontend.md](../frontend.md) — página App Settings
- [ADR-0002](./0002-modelo-document-shaped.md) — modelo document-shaped
