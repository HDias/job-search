# ADR-0001 — SQLite no backend, não no navegador

- **Status:** Aceita
- **Data:** 2026-11-02

## Contexto

O v1 guardava o estado em arquivos JSON lidos e escritos pelo servidor Express (`server.mjs`). A
reescrita em React precisa de uma fonte de dados estruturada, com consultas e integridade, sem
perder a possibilidade de rodar localmente sem infraestrutura.

As alternativas consideradas foram:

1. **SQLite no navegador** (sql.js, wa-sqlite, OPFS) — elimina o backend, mas duplica regras e
   dificulta o pipeline Playwright/LLM, que é server-side.
2. **SQLite no backend** — servidor continua dono dos dados e do pipeline.
3. **Postgres desde já** — mais próximo da nuvem, mas adiciona infraestrutura para um app local.

## Decisão

SQLite roda **no backend**, acessado via `better-sqlite3` + Drizzle ORM. A UI fala HTTP, nunca SQL.
O arquivo fica em `data/job-search.db` e é gitignored.

## Consequências

**Positivas**

- Um único processo e um único arquivo; setup trivial.
- Pipeline pesado continua no mesmo runtime que o banco.
- Transações reais e integridade referencial.
- Caminho direto para Turso/libSQL na nuvem (mesma linguagem).

**Negativas**

- Não há acesso concorrente multiusuário.
- O frontend depende de rede local (aceitável para uso pessoal).
- SQLite tem limitações de `ALTER TABLE`; mudanças de schema exigem migrations cuidadosas.

**Neutras**

- O cliente HTTP do React será o mesmo em qualquer backend futuro.

## Referências

- [architecture.md](../architecture.md)
- [ADR-0003 — Repository pattern e nuvem](./0003-repository-pattern-e-nuvem.md)
