# API

A API do v2 é um servidor Express 5 que roda em `http://localhost:3344` por padrão. Ela expõe
três famílias de rotas:

| Família | Prefixo | Público-alvo |
|---|---|---|
| REST nova | `/api/jobs`, `/api/runs`, `/api/profiles`, `/api/settings`, `/api/stats` | UI React (Fase 2) e integrações |
| Compatibilidade v1 | `/api/applications`, `/api/processes`, `/api/base-resumes`, `/api/pdf-theme`, `/api/candidate-data` | `public/index.html` do v1 |
| Visualizadores | `/applications/*`, `/cv/:id`, `/extras/:id/:view` | Links abertos pelo usuário |

## 1. Convenções

- **JSON em tudo** exceto os visualizadores, que devolvem HTML.
- **Datas em ISO 8601 UTC** (`2026-10-28T12:00:00.000Z`). A única exceção é o DTO legado, que
  devolve `date` no formato `dd/mm/yyyy`.
- **Campos ausentes são `null`**, nunca `undefined`.
- **IDs são opacos** e prefixados: `app_`, `proc_`, `art_`.
- **Paginação** por `limit` e `offset`. Defaults: `50` para jobs, `100` para runs.
- **Erros** seguem sempre o mesmo envelope:

```json
{ "error": "Vaga não encontrada", "details": null }
```

Em erro de validação, `details` traz a lista de `issues` do Zod:

```json
{
  "error": "Dados inválidos",
  "details": [{ "path": ["company"], "message": "Required" }]
}
```

| Código | Quando |
|---|---|
| `200` | Leitura ou atualização bem-sucedida |
| `201` | Criação |
| `204` | Remoção sem corpo |
| `400` | Corpo ou query inválidos, JSON malformado |
| `404` | Recurso ou rota inexistente |
| `413` | Corpo acima de 4 MB |
| `500` | Erro não tratado (logado no servidor) |

## 2. Saúde e estatísticas

### `GET /api/health`

```json
{ "ok": true, "service": "job-search-v2", "time": "2026-11-03T01:00:00.000Z" }
```

### `GET /api/stats`

Calculado sobre as vagas do `owner` (default `local`).

```json
{
  "total": 16,
  "byStatus": { "applied": 13, "drafted": 2, "rejected": 1 },
  "averageFitRating": 69.90625,
  "appliedLast30Days": 12
}
```

- `averageFitRating` é `null` quando nenhuma vaga tem fit.
- `appliedLast30Days` conta `applied_at >= agora - 30 dias`.

## 3. Vagas — `/api/jobs`

### `GET /api/jobs`

| Query | Tipo | Default | Descrição |
|---|---|---|---|
| `status` | enum | — | `drafted`, `applied`, `interview`, `offer`, `rejected`, `archived` |
| `q` | string | — | Busca textual em empresa/cargo |
| `ownerId` | string | `local` | Dono |
| `limit` | int | `50` | Tamanho da página |
| `offset` | int | `0` | Deslocamento |

```json
{
  "items": [
    {
      "id": "app_0191f0c4-...",
      "company": "Andela",
      "role": "Senior Backend Software Engineer",
      "status": "applied",
      "language": "en",
      "stack": "ruby",
      "appliedAt": "2026-10-28T12:00:00.000Z",
      "fit": { "rating": 77.5, "strengths": ["Rails"], "gaps": ["Node.js"] }
    }
  ],
  "total": 16,
  "limit": 50,
  "offset": 0
}
```

`status` inválido responde `400`, não é ignorado.

### `GET /api/jobs/:id`

Devolve o agregado da vaga:

```json
{
  "job": { "id": "app_1", "...": "..." },
  "runs": [{ "id": "proc_1", "stage": "fit-checked", "...": "..." }],
  "artifacts": [
    { "kind": "cv_pdf", "relativePath": "acme/curriculo.pdf", "mime": "application/pdf" }
  ]
}
```

`404` se a vaga não existe.

### `POST /api/jobs`

Corpo validado por `newJobSchema`. Obrigatórios: `company` e `role`.

```json
{
  "company": "Beta",
  "role": "Frontend Engineer",
  "language": "pt-br",
  "stack": "ruby",
  "status": "drafted",
  "vacancyUrl": "https://example.com/job/2"
}
```

Responde `201` com o `Job` criado. `id`, `ownerId`, `createdAt` e `updatedAt` são gerados no
servidor.

### `PATCH /api/jobs/:id`

Aceita qualquer subconjunto de `jobPatchSchema`. O merge do `fit` é **substituição do objeto
inteiro** nesta rota; a mesclagem campo a campo existe apenas no DTO legado.

```json
{ "status": "interview", "fit": { "rating": 88, "strengths": [], "gaps": [] } }
```

### `DELETE /api/jobs/:id`

`204` sem corpo. Os artefatos caem por `ON DELETE CASCADE`; os runs ficam órfãos com
`job_id = NULL` (comportamento intencional — ver [ADR-0002](./adr/0002-modelo-document-shaped.md)).

## 4. Runs — `/api/runs`

### `GET /api/runs`

| Query | Tipo | Default | Descrição |
|---|---|---|---|
| `jobId` | string | — | Filtra por vaga |
| `stage` | string | — | Filtra por estágio |
| `limit` | int | `100` | Página |
| `offset` | int | `0` | Deslocamento |

Devolve um array simples (sem envelope de paginação).

### `GET /api/runs/:id`

`404` se não existe.

### `POST /api/runs`

```json
{
  "jobId": "app_1",
  "stage": "draft",
  "url": "https://example.com/job/1",
  "stack": "ruby",
  "languagePreference": "en"
}
```

### `PATCH /api/runs/:id`

Aceita `stage`, flags (`hasRawText`, `needsFitConfirmation`…), `error`, `fit`, `job` e
`jobSnapshot`.

### `DELETE /api/runs/:id`

`204`.

## 5. Compatibilidade com o v1

Estas rotas existem para o `public/index.html` antigo continuar funcionando durante a migração.
Elas traduzem o domínio novo para o DTO que a UI já conhece. **Não use em código novo.**

### `GET /api/applications`

Lista todas as vagas no formato legado:

```json
[
  {
    "id": "app_1",
    "date": "28/10/2026",
    "company": "Andela",
    "role": "Senior Backend Software Engineer",
    "language": "en",
    "languageConfirmation": "user-confirmed",
    "stack": "ruby",
    "status": "applied",
    "fitRating": 77.5,
    "fitDimensions": { "skillsMatch": 60, "experienceMatch": 85 },
    "fitAnalysis": "Forte aderência em Rails.",
    "strengths": ["Rails"],
    "gaps": ["Node.js"],
    "cvPdfFile": "/applications/acme/curriculo.pdf",
    "emailTextFile": "/applications/acme/email.txt",
    "recruiterNoteFile": "/applications/acme/recrutador.txt",
    "linkedInNoteFile": "/applications/acme/recrutador.txt",
    "questionsFile": null,
    "suggestionsFile": null
  }
]
```

- O fit achatado (`fitRating`, `fitDimensions`, `strengths`…) desfaz o objeto `Fit`.
- `recruiterNoteFile` e `linkedInNoteFile` são fallback um do outro, como no v1.
- Os caminhos de arquivo são públicos (`/applications/...`), servidos por `express.static`.

### `PUT /api/applications/:id`

Aceita o corpo parcial que a UI manda. Conversões relevantes:

| Campo legado | Efeito no domínio |
|---|---|
| `status: "encerrado"` | `rejected` |
| `date: "28/10/2026"` | `appliedAt` em ISO |
| `fitRating`, `fitDimensions`, `strengths`… | merge no `Fit` existente |
| `language` | normaliza para `en` ou `pt-br` |

Responde `{ "success": true, "application": { ... } }`.

### `DELETE /api/applications/:id`

Responde `{ "success": true, "message": "Candidatura removida com sucesso" }`.

### `GET /api/processes`

Lista **apenas runs com `stage != "done"`** — é o que o painel do v1 mostra como checkpoints
pendentes. O DTO mantém `job`, `jobSnapshot`, `applicationId` e o fit achatado.

### `PUT /api/processes/:id`

Aceita `applicationId: null` para desvincular o run da vaga, `fit`, `job`, `jobSnapshot` e flags.

### `DELETE /api/processes/:id`

Responde `{ "success": true }`.

### Metadados

| Método | Rota | Formato |
|---|---|---|
| GET | `/api/base-resumes` | `{ "pt-br": { exists, language, sourceFile, updatedAt, charCount, preview }, ... }` |
| GET | `/api/pdf-theme` | `{ success, theme }` |
| PUT | `/api/pdf-theme` | valida `#RRGGBB`; devolve o tema normalizado em maiúsculas |
| GET | `/api/candidate-data` | `{ success, candidate }` |
| PUT | `/api/candidate-data` | deriva `firstName`/`lastName` de `fullName` |

## 6. Perfis e settings

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/profiles` | Lista perfis base |
| GET | `/api/profiles/:stack/:language` | Um perfil; `404` se ausente |
| PUT | `/api/profiles/:stack/:language` | `{ "content": {...} }` faz upsert |
| GET | `/api/settings` | Lista `{ key, value, updatedAt }` |
| GET | `/api/settings/:key` | `404` se ausente |
| PUT | `/api/settings/:key` | `{ "value": ... }` |

Chaves conhecidas: `pdf_theme`, `candidate_form`. Chaves de API **não** são armazenadas aqui.

## 7. Visualizadores

### `GET /cv/:id`

Renderiza o HTML do currículo com uma barra fixa contendo empresa, cargo, fit, botão de download
do PDF e botão de impressão. Se o HTML não existir mas o PDF sim, tenta o `.html` de mesmo nome.
Se nenhum dos dois existir, devolve `404` com uma página de aviso — o registro existe, mas o
arquivo sumiu do disco.

### `GET /extras/:id/:view`

`view` ∈ `email`, `recruiter`, `suggestions`. Renderiza o conteúdo em `<pre>` com link para o
arquivo original. `404` para visão desconhecida; `200` com aviso quando não há material.

### Estáticos

- `/applications/*` → `APPLICATIONS_DIR`
- `/base_profile/*` → `BASE_PROFILE_DIR`

Caminhos são resolvidos e validados contra *path traversal* (ver [security.md](./security.md)).

## 8. Exemplos com `curl`

```bash
# Listar vagas aplicadas
curl 'http://localhost:3344/api/jobs?status=applied&limit=5'

# Estatísticas
curl http://localhost:3344/api/stats

# Atualizar status
curl -X PATCH http://localhost:3344/api/jobs/app_1 \
  -H 'content-type: application/json' \
  -d '{"status":"interview"}'

# Formato legado (UI v1)
curl http://localhost:3344/api/applications

# Currículo renderizado
open http://localhost:3344/cv/app_1
```

## 9. O que ainda não existe

Rotas do pipeline pesado continuam apenas no v1:

- `POST /api/process-job`
- `POST /api/fit-check`
- upload/extração de currículo base
- regeneração de kit (`/api/applications/:id/regenerate`)
- fila interativa (`/api/processes/:id/question`, `/respond`)

Elas dependem de Playwright, LLM e geração de PDF, que serão portados como serviços na Fase 3
(ver [roadmap.md](./roadmap.md)).
