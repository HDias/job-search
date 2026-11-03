# ADR-0005 — Identidade, datas e nulos

- **Status:** Aceita
- **Data:** 2026-11-02

## Contexto

O v1 usava IDs numéricos acoplados a `Date.now()` (`app_1793504688485`), datas de exibição
(`28/10/2026`) e `undefined` em vários pontos. Isso gera colisões teóricas, ordenação incorreta e
problemas ao persistir em bancos que rejeitam `undefined` (Firestore).

## Decisão

### IDs

- Prefixo por tipo + UUID: `app_<uuid>`, `proc_<uuid>`, `art_<uuid>`.
- IDs são opacos para a UI; nunca inferir tipo pelo formato além do prefixo.
- IDs importados do v1 são **preservados** quando já têm prefixo, para não quebrar links e
  referências de artefatos.

### Datas

- Persistência e transporte em **ISO 8601 UTC** (`2026-10-28T12:00:00.000Z`).
- Conversão para `dd/mm/yyyy` **apenas** no DTO de compatibilidade (`isoToBrDate`).
- Datas inválidas na importação viram `null` com aviso; nunca `Invalid Date`.

### Nulos

- Campos ausentes são `null`, nunca `undefined`.
- `nullify()` normaliza na escrita; `parseFit`/`parseJobSnapshot` normalizam na leitura.
- Booleanos são `0/1` no SQLite e convertidos para `boolean` no mapper.

## Consequências

**Positivas**

- Ordenação lexicográfica de ISO equivale à cronológica.
- Sem ambiguidade de fuso: tudo UTC; a UI formata localmente.
- Compatível com Firestore, que rejeita `undefined`.
- UUIDs evitam colisão em importações e em eventual multiusuário.

**Negativas**

- `Date` nativo do JS não é usado no domínio; strings exigem disciplina.
- A UI precisa formatar datas para o usuário.
- Preservar IDs antigos significa conviver com dois formatos (`app_<timestamp>` e `app_<uuid>`).

**Regra**

Nunca comparar datas como string sem garantir ISO. Para "hoje", use o fuso do usuário apenas na
apresentação.

## Referências

- [data-model.md](../data-model.md)
- `src/domain/dates.ts`
- `src/domain/ids.ts`
