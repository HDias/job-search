# Segurança

## 1. Modelo de ameaça atual

O v2 é uma aplicação **local, single-user**, sem autenticação. O modelo assume que só o dono da
máquina acessa `localhost:3344`. Isso é aceitável para o estágio atual e **inaceitável** para
qualquer exposição de rede ou nuvem.

| Ativo | Sensibilidade | Onde está |
|---|---|---|
| Currículos e cartas | Alta (dados pessoais) | `applications/` |
| Perfis base | Alta | `base_profile/` ou `profiles.content` |
| Dados de candidatura | Média | `data/job-search.db` |
| Chave de LLM | Crítica | `config.json` do v1, **fora** do v2 |
| Configuração de tema | Baixa | `settings` |

## 2. Segredos

- `config.json` do v1 **não é importado**. A chave de LLM continua apenas no arquivo antigo.
- `.env` e `.env.*` são gitignored; `.env.example` é versionado sem valores reais.
- `settings` guarda apenas preferências (`pdf_theme`, `candidate_form`); nunca tokens.
- Nenhum segredo é logado. O handler global imprime o erro, não o corpo da requisição.

### Regra para a Fase 3

Quando o pipeline LLM for portado, a chave deve vir de variável de ambiente ou de um secret
manager — nunca do banco nem do repositório. Ver [roadmap.md](./roadmap.md).

## 3. Validação de entrada

Toda escrita passa por Zod na borda (`parseBody` em `src/api/http.ts`):

- `newJobSchema`, `jobPatchSchema`, `newRunSchema`, `runPatchSchema`.
- Enums de status e limites de tamanho.
- Cor de tema validada por regex `^#[0-9a-fA-F]{6}$`.
- Corpo JSON limitado a **4 MB** (`express.json({ limit: '4mb' })`).

O DTO legado (`/api/applications`, `/api/processes`) aceita corpos mais livres porque replica o
que a UI v1 enviava, mas ainda converte tipos e ignora campos desconhecidos. **Não é uma superfície
para código novo.**

### SQL injection

Todo acesso ao banco usa Drizzle com queries parametrizadas. Não há interpolação de string em SQL.

Nota: a busca textual (`q`) usa `LIKE` com o valor parametrizado; wildcards `%` e `_` enviados pelo
usuário são tratados como padrão. Para uso local é aceitável; se virar multiusuário, escape-os.

## 4. Path traversal

Os visualizadores e estáticos leem arquivos do disco a partir de caminhos guardados no banco.
`src/api/routes/viewers.ts` resolve o caminho e verifica se ele permanece dentro do diretório base:

```ts
function safeResolve(baseDir: string, relativePath: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return fs.existsSync(target) ? target : null;
}
```

Isso bloqueia `../../etc/passwd` e symlinks que apontem para fora? **Symlinks não são resolvidos**
(`realpath` não é usado), então um symlink dentro de `applications/` apontando para fora ainda
seria lido. Como só o dono escreve nesse diretório, o risco é baixo; ao migrar para upload
multiusuário, troque por `fs.realpath` + verificação de prefixo.

`/applications/*` e `/base_profile/*` são servidos por `express.static`, que já normaliza `..` e
não segue symlinks para fora da raiz por padrão.

## 5. XSS

Os visualizadores montam HTML com `escapeHtml()` em todo dado vindo do banco (empresa, cargo,
conteúdo de arquivo). O HTML do currículo em si é inserido como veio do disco — ele é gerado pelo
próprio pipeline e contém CSS/HTML controlado, não entrada de usuário externo.

Ao portar para React, a regra é: **nunca `dangerouslySetInnerHTML`** em conteúdo de vaga ou
mensagem de recrutador. O currículo pode precisar de iframe isolado, dado que é um documento
completo.

## 6. CORS e exposição de rede

Não há CORS configurado. O servidor escuta em todas as interfaces por padrão do Express
(`app.listen(port)`), então em uma rede compartilhada ele fica acessível. Para uso local estrito:

```bash
PORT=3344 HOST=127.0.0.1 pnpm dev
```

> O `HOST` ainda não é lido por `src/config.ts`; hoje o bind é o default do Node. Se isso importar,
> ajuste `app.listen(config.port, '127.0.0.1')`.

Em nuvem, será necessário:

1. autenticação (provedor de identidade);
2. `owner_id` real em todas as consultas, não o default `local`;
3. CORS restrito ao domínio da UI;
4. rate limiting nas rotas de escrita e no pipeline;
5. CSRF se cookies forem usados.

## 7. Dados pessoais (LGPD)

O app guarda currículo, e-mail, telefone e histórico de candidaturas. Hoje tudo fica na máquina do
usuário. Ao migrar para nuvem:

- defina base legal e prazo de retenção;
- permita exportação e exclusão por titular;
- criptografe em repouso (o provedor de banco e o storage fazem isso);
- restrinja logs para não registrar conteúdo de currículo;
- cuidado com artefatos em bucket público — use URLs assinadas.

## 8. Dependências

- `pnpm audit` não está no CI. Rode manualmente antes de releases.
- `better-sqlite3` e `esbuild` têm scripts de build liberados explicitamente em
  `pnpm-workspace.yaml`; qualquer nova dependência com script de instalação exige revisão.
- Versões estão fixadas no `pnpm-lock.yaml`.

## 9. Checklist antes de expor o v2

- [ ] Autenticação e autorização por `owner_id`
- [ ] Bind em `127.0.0.1` ou proxy reverso com TLS
- [ ] CORS restrito
- [ ] Rate limiting
- [ ] Segredos em secret manager
- [ ] Backup e retenção definidos
- [ ] `pnpm audit` limpo
- [ ] Revisão de logs (sem PII)
- [ ] Testes de autorização (hoje inexistentes)
