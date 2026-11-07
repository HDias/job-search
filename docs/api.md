# API

The v2 API is an Express 5 server running at `http://localhost:3344` by default. It exposes three
route families:

| Family | Prefix | Audience |
|---|---|---|
| New REST | `/api/jobs`, `/api/runs`, `/api/profiles`, `/api/settings`, `/api/stats`, `/api/llm-config` | React UI (Phase 2) and integrations |
| v1 compatibility | `/api/applications`, `/api/processes`, `/api/base-resumes`, `/api/pdf-theme`, `/api/candidate-data` | the v1 UI |
| Viewers | `/applications/*`, `/cv/:id`, `/extras/:id/:view` | Links opened by the user |

## 1. Conventions

- **JSON everywhere** except the viewers, which return HTML.
- **Dates in ISO 8601 UTC** (`2026-10-28T12:00:00.000Z`). The only exception is the legacy DTO,
  which returns `date` in `dd/mm/yyyy` format.
- **Missing fields are `null`**, never `undefined`.
- **IDs are opaque** and prefixed: `app_`, `proc_`, `art_`.
- **Pagination** via `limit` and `offset`. Defaults: `50` for jobs, `100` for runs.
- **Errors** always follow the same envelope:

```json
{ "error": "Vaga não encontrada", "details": null }
```

On validation errors, `details` carries the list of Zod `issues`:

```json
{
  "error": "Dados inválidos",
  "details": [{ "path": ["company"], "message": "Required" }]
}
```

| Code | When |
|---|---|
| `200` | Successful read or update |
| `201` | Creation |
| `204` | Removal without body |
| `400` | Invalid body or query, malformed JSON |
| `404` | Missing resource or route |
| `409` | Conflict (e.g.: `stack × language` target already exists) |
| `413` | Body above 4 MB |
| `500` | Unhandled error (logged server-side) |

## 2. Health and statistics

### `GET /api/health`

```json
{ "ok": true, "service": "job-search-v2", "time": "2026-11-03T01:00:00.000Z" }
```

### `GET /api/stats`

Computed over the `owner`'s jobs (default `local`).

```json
{
  "total": 16,
  "byStatus": { "applied": 13, "drafted": 2, "rejected": 1 },
  "averageFitRating": 69.90625,
  "appliedLast30Days": 12
}
```

- `averageFitRating` is `null` when no job has a fit.
- `appliedLast30Days` counts `applied_at >= now - 30 days`.

## 3. Jobs — `/api/jobs`

### `GET /api/jobs`

| Query | Type | Default | Description |
|---|---|---|---|
| `status` | enum | — | `drafted`, `applied`, `interview`, `offer`, `rejected`, `archived` |
| `q` | string | — | Text search over company/role |
| `ownerId` | string | `local` | Owner |
| `limit` | int | `50` | Page size |
| `offset` | int | `0` | Displacement |

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

An invalid `status` responds `400`, it is not ignored.

### `GET /api/jobs/:id`

Returns the job aggregate:

```json
{
  "job": { "id": "app_1", "...": "..." },
  "runs": [{ "id": "proc_1", "stage": "fit-checked", "...": "..." }],
  "artifacts": [
    { "kind": "cv_pdf", "relativePath": "acme/curriculo.pdf", "mime": "application/pdf" }
  ]
}
```

`404` if the job doesn't exist.

### `POST /api/jobs`

Body validated by `newJobSchema`. Required: `company` and `role`.

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

Responds `201` with the created `Job`. `id`, `ownerId`, `createdAt` and `updatedAt` are generated
server-side.

### `PATCH /api/jobs/:id`

Accepts any subset of `jobPatchSchema`. The `fit` merge is a **replacement of the whole object**
on this route; field-by-field merging only exists in the legacy DTO.

```json
{ "status": "interview", "fit": { "rating": 88, "strengths": [], "gaps": [] } }
```

### `DELETE /api/jobs/:id`

`204` without body. Artifacts fall via `ON DELETE CASCADE`; runs become orphans with
`job_id = NULL` (intentional behavior — see [ADR-0002](./adr/0002-document-shaped-model.md)).

## 4. Runs — `/api/runs`

### `GET /api/runs`

| Query | Type | Default | Description |
|---|---|---|---|
| `jobId` | string | — | Filters by job |
| `stage` | string | — | Filters by stage |
| `limit` | int | `100` | Page |
| `offset` | int | `0` | Displacement |

Returns a plain array (no pagination envelope).

### `GET /api/runs/:id`

`404` if it doesn't exist.

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

Accepts `stage`, flags (`hasRawText`, `needsFitConfirmation`…), `error`, `fit`, `job` and
`jobSnapshot`.

### `DELETE /api/runs/:id`

`204`.

## 5. Compatibility with v1

These routes exist so the v1 UI keeps working during the migration. They
translate the new domain into the DTO the UI already knows. **Do not use them in new code.**

### `GET /api/applications`

Lists all jobs in the legacy format:

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

- The flattened fit (`fitRating`, `fitDimensions`, `strengths`…) undoes the `Fit` object.
- `recruiterNoteFile` and `linkedInNoteFile` fall back to each other, as in v1.
- File paths are public (`/applications/...`), served by `express.static`.

### `PUT /api/applications/:id`

Accepts the partial body the UI sends. Relevant conversions:

| Legacy field | Effect on the domain |
|---|---|
| `status: "encerrado"` | `rejected` |
| `date: "28/10/2026"` | `appliedAt` in ISO |
| `fitRating`, `fitDimensions`, `strengths`… | merge into the existing `Fit` |
| `language` | normalizes to `en` or `pt-br` |

Responds `{ "success": true, "application": { ... } }`.

### `DELETE /api/applications/:id`

Responds `{ "success": true, "message": "Candidatura removida com sucesso" }`.

### `GET /api/processes`

Lists **only runs with `stage != "done"`** — that's what the v1 panel shows as pending checkpoints.
The DTO keeps `job`, `jobSnapshot`, `applicationId` and the flattened fit.

### `PUT /api/processes/:id`

Accepts `applicationId: null` to detach the run from the job, plus `fit`, `job`, `jobSnapshot` and
flags.

### `DELETE /api/processes/:id`

Responds `{ "success": true }`.

### Metadata

| Method | Route | Format |
|---|---|---|
| GET | `/api/base-resumes` | `{ "pt-br": { exists, language, sourceFile, updatedAt, charCount, preview }, ... }` |
| GET | `/api/pdf-theme` | `{ success, theme }` |
| PUT | `/api/pdf-theme` | validates `#RRGGBB`; returns the theme normalized to uppercase |
| GET | `/api/candidate-data` | `{ success, candidate }` |
| PUT | `/api/candidate-data` | derives `firstName`/`lastName` from `fullName` |

## 6. Profiles (targets) and settings

A **target** is a row in `profiles`, identified by `(stack, language)`. Each target stores the base
resume (`content`), an `enabled` flag and extra prompt instructions (`extraPrompt`).

| Method | Route | Description |
|---|---|---|
| GET | `/api/profiles` | Lists targets. Optional query `?enabled=true\|false` |
| GET | `/api/profiles/:stack/:language` | One target; `404` if missing |
| POST | `/api/profiles` | Creates a target; `201`; `409` if the combination already exists |
| PUT | `/api/profiles/:stack/:language` | Partial update of `content`, `enabled`, `extraPrompt` |
| DELETE | `/api/profiles/:stack/:language` | `204`; `404` if missing |
| GET | `/api/settings` | Lists `{ key, value, updatedAt }` |
| GET | `/api/settings/:key` | `404` if missing |
| PUT | `/api/settings/:key` | `{ "value": ... }` |

Example `Profile`:

```json
{
  "stack": "php",
  "language": "en",
  "content": { "rawText": "...", "rawLength": 1234, "sourceFile": "curriculo.html" },
  "enabled": true,
  "extraPrompt": "Priorizar Laravel e APIs REST; evitar tom acadêmico.",
  "updatedAt": "2026-11-07T12:00:00.000Z"
}
```

Rules:

- **Stack**: `trim` + lowercase; slug `^[a-z][a-z0-9-]{0,31}$`; invalid → `400`.
- **Language**: `pt-br` or `en`; anything else → `400`.
- **Duplicate `POST`**: `409` (`Essa combinação já existe`), without overwriting.
- **Partial `PUT`**: missing fields keep their current value; `{}` → `400`. `PUT` also creates the
  target if it doesn't exist (upsert).
- **`extraPrompt`**: up to 8000 characters; an empty/whitespace-only string becomes `null`.
- **`DELETE`** removes the row and therefore the stored resume. To pause without losing data, use
  `PUT { "enabled": false }`.
- **`enabled = false`**: the target stays editable and visible in the API; the future pipeline
  should ignore it.
- **`/api/base-resumes`** keeps the legacy format (4 fixed keys) for v1; the new screen uses
  `/api/profiles`.

### LLM configuration — `/api/llm-config`

| Method | Route | Description |
|---|---|---|
| GET | `/api/llm-config` | `{ provider, model, baseUrl, temperature, top_p, maxTokens, hasKey, maskedKey }` — the key itself is never returned |
| PUT/POST | `/api/llm-config` | Partial update; returns `{ success, message }`. `POST` is an alias for the v1 UI |

- Stored in `settings` under the key `llm_config`. The local database keeps the saved key; the API
  exposes it only masked (`ABCDEF...WXYZ`).
- Partial semantics: missing fields keep their current value; `null` clears a sampling field;
  `apiKey: ""` keeps the current key (parity with the v1 UI, which resends an empty field when the
  user did not change the key).
- Changing `provider` without `model` falls back to the new provider's default model
  (`gemini-2.5-flash`, `gpt-4o`, `gpt-4o-mini`, `openai/gpt-oss-20b`, `claude-3-5-sonnet-20241022`).
- With no saved key and provider `gemini`, the client uses `GEMINI_API_KEY` from the environment.
- Validation: provider ∈ `gemini, openai, openai-compatible, nvidia, anthropic`; `temperature`
  0–2; `top_p` 0–1; `maxTokens` 1–32000; empty body → `400`.

Known settings keys: `pdf_theme`, `candidate_form`, `llm_config`.

## 7. Viewers

### `GET /cv/:id`

Renders the resume HTML with a fixed bar containing company, role, fit, a PDF download button and a
print button. If the HTML doesn't exist but the PDF does, it tries the `.html` of the same name.
If neither exists, it returns `404` with a warning page — the record exists, but the file is gone
from disk.

### `GET /extras/:id/:view`

`view` ∈ `email`, `recruiter`, `suggestions`. Renders the content in `<pre>` with a link to the
original file. `404` for an unknown view; `200` with a warning when there is no material.

### Static

- `/applications/*` → `APPLICATIONS_DIR`
- `/base_profile/*` → `BASE_PROFILE_DIR`

Paths are resolved and validated against *path traversal* (see [security.md](./security.md)).

### SPA in production

When `web/dist` exists, Express serves the React assets and returns `index.html` for navigation
routes (`/`, `/jobs/:id`). The `/api`, `/applications`, `/base_profile`, `/cv` and `/extras`
prefixes stay **out** of the fallback, so a missing artifact keeps returning `404` instead of
turning into HTML. The directory can be changed via `WEB_DIST`.

## 8. `curl` examples

```bash
# List applied jobs
curl 'http://localhost:3344/api/jobs?status=applied&limit=5'

# Statistics
curl http://localhost:3344/api/stats

# Update status
curl -X PATCH http://localhost:3344/api/jobs/app_1 \
  -H 'content-type: application/json' \
  -d '{"status":"interview"}'

# Legacy format (v1 UI)
curl http://localhost:3344/api/applications

# Rendered resume
open http://localhost:3344/cv/app_1
```

## 9. What doesn't exist yet

Heavy pipeline routes still live only in v1:

- `POST /api/process-job`
- `POST /api/fit-check`
- base resume upload/extraction
- kit regeneration (`/api/applications/:id/regenerate`)
- interactive queue (`/api/processes/:id/question`, `/respond`)

They depend on Playwright, LLM and PDF generation and are being ported slice by slice; the LLM
client, the skill prompt loader and `/api/llm-config` already live in v2
(`src/pipeline/`). The step plan is in `.plans/pipeline-port-v1-v2.md` and the phase goals in
[roadmap.md](./roadmap.md).
