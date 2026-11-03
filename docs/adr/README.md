# Architecture Decision Records

Registro das decisões estruturais do v2. Cada ADR é curto, tem contexto, decisão e consequências,
e **não é reescrito** — quando uma decisão muda, cria-se outro ADR que a substitui.

| # | Decisão | Status |
|---|---|---|
| [0001](./0001-sqlite-no-backend.md) | SQLite no backend, não no navegador | Aceita |
| [0002](./0002-modelo-document-shaped.md) | Modelo document-shaped para facilitar a nuvem | Aceita |
| [0003](./0003-repository-pattern-e-nuvem.md) | Repository pattern e caminho de nuvem | Aceita |
| [0004](./0004-estrategia-strangler-compatibilidade-v1.md) | Strangler com camada de compatibilidade | Aceita |
| [0005](./0005-identidade-datas-e-nulos.md) | IDs prefixados, ISO 8601 e `null` | Aceita |
| [0006](./0006-artefatos-no-filesystem.md) | Artefatos no filesystem, metadados no banco | Aceita |
| [0007](./0007-zod-na-borda.md) | Zod na borda HTTP | Aceita |
| [0008](./0008-vitest-supertest.md) | Vitest + Supertest | Aceita |

## Formato

```markdown
# ADR-000N — Título

- **Status:** Aceita | Substituída por ADR-XXXX | Rejeitada
- **Data:** AAAA-MM-DD
- **Contexto:** ...

## Decisão
...

## Consequências
...
```

## Quando escrever um ADR

- Troca de banco, framework ou runtime.
- Mudança no formato de IDs, datas ou tratamento de nulos.
- Nova camada arquitetural.
- Decisão que será cara de reverter.
- Qualquer "por que fizeram assim?" provável no futuro.

Não escreva ADR para detalhes locais de implementação, nomes de variáveis ou correções de bug.
