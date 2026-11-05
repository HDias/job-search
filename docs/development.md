# Desenvolvimento

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | 24.13.0 | Definido em `.tool-versions` |
| pnpm | 11.3.0 | `packageManager` não é usado; ver seção 3 |
| Python 3 | opcional | Só se você for repetir os ajustes em massa feitos na migração |

Se você usa `asdf`:

```bash
asdf install
```

## 2. Instalação

```bash
git clone <repo>
cd job-search-v2
pnpm install
```

Na primeira instalação, o pnpm compila `better-sqlite3` e `esbuild` do código-fonte. Isso é
liberado em `pnpm-workspace.yaml`:

```yaml
packages:
  - web

allowBuilds:
  better-sqlite3: true
  esbuild: true
```

Sem esse bloco, o `better-sqlite3` falha com erro de binário nativo. `packages` registra `web/`
como pacote do workspace.

## 3. pnpm 11

O pnpm 11 não lê mais o campo `pnpm` do `package.json`. Configurações de build ficam em
`pnpm-workspace.yaml`. Se você adicionar uma dependência que precise de script de instalação,
declare-a em `allowBuilds`.

## 4. Banco de dados

O banco fica em `data/job-search.db` (gitignored). Para criar do zero:

```bash
pnpm db:migrate
```

A API também roda as migrations no boot (`runMigrations(store.db)` em `src/api/server.ts`), então
`pnpm dev` já deixa o banco pronto. Rodar `db:migrate` explicitamente é útil em CI e antes de
importar.

### Importar dados do v1

```bash
pnpm db:import -- --tracker ../job-search
pnpm db:import -- --reset        # limpa e reimporta
```

Detalhes em [migration-v1-v2.md](./migration-v1-v2.md).

## 5. Variáveis de ambiente

Copie `.env.example` para `.env` se quiser sobrescrever os defaults. O projeto **não** carrega
`.env` automaticamente; exporte as variáveis ou use `dotenv` no seu shell.

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3344` | Porta da API |
| `DB_FILE` | `./data/job-search.db` | Caminho do SQLite |
| `APPLICATIONS_DIR` | `../job-search/applications` | Artefatos gerados |
| `BASE_PROFILE_DIR` | `../job-search/base_profile` | Perfis base |
| `WEB_DIST` | `./web/dist` | Build do React servido pelo Express |

Defaults são resolvidos com `path.resolve` a partir da raiz do projeto (`src/config.ts`).

## 6. Comandos

```bash
pnpm dev            # API com watch em http://localhost:3344
pnpm start          # API sem watch (serve web/dist se existir)
pnpm dev:web        # Vite em http://localhost:5173
pnpm build:web      # build de produção em web/dist
pnpm typecheck      # backend: tsc --noEmit
pnpm typecheck:web  # frontend: tsc --noEmit
pnpm test           # backend: Vitest (ambiente Node)
pnpm test:web       # frontend: Vitest (jsdom)
pnpm db:migrate     # aplica migrations
pnpm db:import      # importa o v1
```

### Rodando o frontend

Em desenvolvimento, dois terminais:

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm dev:web
```

O Vite faz proxy de `/api`, `/applications`, `/base_profile`, `/cv` e `/extras` para a API na
`3344`. Não é preciso configurar CORS.

Em produção:

```bash
pnpm build:web
pnpm start
```

Tudo fica em `http://localhost:3344`: API, artefatos e SPA. Detalhes em
[frontend.md](./frontend.md).

## 7. Rodando ao lado do v1

O v1 usa a porta `3333` e o v2 a `3344`. Os dois podem rodar juntos:

```bash
# terminal 1
cd ../job-search && pnpm start

# terminal 2
cd ../job-search-v2 && pnpm dev
```

O v2 aponta por padrão para `../job-search/applications` e `../job-search/base_profile`, então os
artefatos aparecem nos visualizadores sem cópia. **Não aponte os dois para o mesmo banco** — o v1
não conhece o schema novo.

## 8. Fluxo de desenvolvimento

1. Altere o domínio em `src/domain/` (tipos + schema Zod).
2. Se mudou schema, ajuste `src/db/schema.ts` e rode `pnpm drizzle-kit generate`.
3. Ajuste/adicione o repositório em `src/repositories/sqlite/`.
4. Exponha na rota em `src/api/routes/`.
5. Cubra com teste em `test/`.
6. `pnpm typecheck && pnpm test`.
7. Se mudou a UI, rode `pnpm typecheck:web && pnpm test:web`.
8. Atualize a doc e, se for decisão estrutural, escreva um ADR.

### Alterando o frontend

- Páginas em `web/src/pages/`, componentes em `web/src/components/`.
- Chamadas de API em `web/src/api/client.ts`; hooks em `web/src/api/hooks.ts`.
- Tipos espelham `src/domain/` em `web/src/api/types.ts`. Ao mudar um campo no backend, atualize os
  dois lados.
- Estilo único em `web/src/styles.css`.
- Testes ao lado do código (`*.test.tsx`).

### Criando uma migration

```bash
pnpm drizzle-kit generate --name=minha_mudanca
```

O SQL vai para `drizzle/000N_minha_mudanca.sql` e o snapshot para `drizzle/meta/`. **Nunca edite
uma migration já aplicada**; crie outra.

Migrations destrutivas em SQLite (drop/rename de coluna) exigem recriar a tabela. O
`drizzle-kit` gera o SQL, mas revise antes de aplicar.

### Adicionando uma rota

```ts
// src/api/routes/exemplo.ts
import { Router } from 'express';
import type { Store } from '../../repositories/types.js';
import { HttpError } from '../http.js';

export function createExemploRouter(store: Store): Router {
  const router = Router();

  router.get('/:id', (req, res) => {
    const item = store.jobs.get(req.params.id);
    if (!item) throw new HttpError(404, 'Não encontrado');
    res.json(item);
  });

  return router;
}
```

Registre em `src/api/app.ts` **antes** de `notFoundHandler`. Erros lançados como `HttpError` são
convertidos pelo `errorHandler` central.

## 9. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Could not locate the bindings file` | `better-sqlite3` não compilou | `pnpm rebuild better-sqlite3`; confira `allowBuilds` |
| `SQLITE_BUSY` | Dois processos escrevendo | Use um processo por banco; WAL ajuda mas não elimina |
| `banco já contém dados` no import | Importação sem `--reset` | `pnpm db:import -- --reset` |
| Artefato 404 | Caminho errado em `APPLICATIONS_DIR` | Confira a variável e o `relativePath` no banco |
| `status inválido` | Enum diferente do domínio | Veja a lista em [data-model.md](./data-model.md) |
| Porta ocupada | v1 ou instância antiga | `lsof -i :3344` ou `lsof -i :5173` |
| SPA devolve 404 em produção | `web/dist` não existe | `pnpm build:web` |

## 10. Estilo

- TypeScript ESM (`"type": "module"`), imports com extensão `.js`.
- Sem framework de lint configurado; o `tsc --noEmit` é o portão.
- Comentários e mensagens de erro em português, código em inglês.
- Funções pequenas; regra de negócio no domínio, não na rota.
