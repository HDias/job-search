# API

The v2 API is an Express 5 server running at `http://localhost:3344` by default. It exposes three
route families:

| Family | Prefix | Audience |
|---|---|---|
| New REST | `/api/jobs`, `/api/runs`, `/api/profiles`, `/api/settings`, `/api/stats`, `/api/llm-config`, `/api/jobs/:id/apply-confirm` | React UI and integrations |
| Pipeline | `/api/fit-check`, `/api/evaluate-fit`, `/api/generate-kit`, `/api/runs/:id/question`, `/api/runs/:id/respond`, `/api/jobs/:id/regenerate`, `/api/jobs/:id/prefill`, `/api/jobs/:id/questions`, `/api/jobs/:id/chat`, `/api/profiles/:stack/:language/upload` | React UI and integrations |
| Legacy compatibility | `/api/applications`, `/api/applications/:id/apply-confirm`, `/api/processes`, `/api/base-resumes`, `/api/pdf-theme`, `/api/candidate-data` | the legacy UI |
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
| `409` | Conflict (e.g.: `stack × language` target already exists, or a pipeline gate blocked the run) |
| `413` | Body above 4 MB, or a resume upload above 10 MB |
| `422` | The uploaded file has no extractable text |
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

### `POST /api/jobs/:id/apply-confirm`

Records that the user applied manually. The app never submits a form, so the body must carry an
explicit `approved: true`; omitted or `false` answers `400` and leaves the job untouched.

```json
{
  "approved": true,
  "note": "Applied through the recruiter form.",
  "channel": "Recruiter",
  "appliedEmails": ["you@example.com", "recruiter@example.com"]
}
```

Effects on the job:

- `status: "applied"`, `applyMethod: "manual"`, `appliedAt` as ISO 8601 UTC.
- `channel`: the body → the job's channel → `portal`, lowercased and capped at **30** chars.
- `appliedEmails`: accepts an array or a comma/semicolon/newline string; trims, drops blanks and
  duplicates and keeps the first **10**.
- `applyNote`: capped at **500** chars.

Responds `200 { "success": true, "job": { ... } }`; `404` for an unknown job. The legacy UI keeps
`POST /api/applications/:id/apply-confirm` with the v1 envelope (§5).

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
  "stage": "queued",
  "url": "https://example.com/job/1",
  "stack": "ruby",
  "languagePreference": "en"
}
```

Stages follow the v1 vocabulary plus the async model:
`queued → scraping → scrape-thin | fit-checked → generating ⇄ needs_input → done | failed`.
A `failed` or `needs_input` run is resumable.

### `PATCH /api/runs/:id`

Accepts `stage`, flags (`hasRawText`, `needsFitConfirmation`…), `error`, `fit`, `job`,
`jobSnapshot`, `llmQuestion`, `needsInputRounds`, `clarificationHistory`,
`coverLetterGuidance` and `includeCoverInCv`.

### `DELETE /api/runs/:id`

`204`.

### `POST /api/fit-check`

Native async fit check (Phase 2). Validates the body, creates a `queued` run and answers
**`202 { "runId": "proc_..." }`**. The in-process FIFO worker (one execution at a time) scrapes
or reuses a snapshot, calls the LLM with the live skill framework and persists the result:

- success → stage `fit-checked`, `fit`, `job`, `jobSnapshot`;
- thin scrape → stage `scrape-thin`, `jobSnapshot.contentThin: true`, no fit and no LLM call;
- failure → stage `failed` with `error`, resumable.

```json
{
  "url": "https://example.com/job/1",
  "rawText": null,
  "extraQuestions": null,
  "recruiterMessage": null,
  "languagePreference": "auto",
  "stack": "ruby",
  "processId": null,
  "jobSnapshot": null
}
```

Poll `GET /api/runs/:id`. `processId` resumes an existing checkpoint and resets it to `queued`.

### `POST /api/evaluate-fit`

Synchronous, deterministic hybrid fit ("Retry fit" in v1). It never calls the LLM and never
uses the queue. Loads the **enabled** PT/EN targets of the stack and returns the v1 shape:

```json
{
  "success": true,
  "fitPercentage": 72,
  "language": "en",
  "breakdown": { "semantic": 0.61, "temporal": 0.8, "evidence": 0.5 },
  "explanation": "...",
  "details": { "semantic": {}, "temporal": {}, "evidence": [], "jobRequirements": {} },
  "metadata": { "algorithm": "hybrid-v1", "latencyMs": 42 }
}
```

When `applicationId` is informed, the job's `fit` is updated (rating, dimensions, analysis).
`400` when `jobText` is empty or no enabled base resume exists.

## 4.1 Kit generation — `POST /api/generate-kit`

Native async kit generation (Phase 3/4). Accepts an existing `processId` or a fresh source
(`url`, `rawText` or `jobSnapshot`) and answers **`202 { "runId": "proc_..." }`**. The same FIFO
worker scrapes when needed, builds the kit prompt from the enabled target and writes the
artifacts:

- valid kit → stage `done`, job updated, artifact rows created;
- a blocking question → stage `needs_input` with `llmQuestion` (at most **2 rounds**);
- exhausted validation retries (2 fix prompts) → stage `failed` with `error`, resumable.

```json
{
  "processId": "proc_1",
  "language": "en",
  "languagePreference": "en",
  "stack": "ruby",
  "fitConfirmed": false,
  "jobSnapshot": null
}
```

Gates answer `409` **before** reaching the queue and the LLM:

| Situation | Response |
|---|---|
| No explicit language | `needsLanguageConfirmation: true` + hint |
| `fit.rating < 50` or eligibility failed without `fitConfirmed` | `needsFitConfirmation: true` (+ `eligibilityBlocked`, `fitRating`) |
| The posting explicitly requires another language | `needsLanguageConfirmation: true` + `jobRequiredLanguage` |

`fit.rating === 50` proceeds, and a mere detection divergence does not block. Replaying a
`needs_input` run without a new answer returns the same question and makes **zero** LLM calls.

## 4.2 Interactive queue — `GET /api/runs/:id/question` and `POST /api/runs/:id/respond`

```json
// GET /api/runs/proc_1/question
{
  "runId": "proc_1",
  "processId": "proc_1",
  "question": {
    "question": "Which PostgreSQL version did you run in production?",
    "options": ["PostgreSQL 12", "PostgreSQL 14"],
    "blockingField": "postgres_version",
    "kind": "missing_fact",
    "inferences": [],
    "rawExcerpt": ""
  },
  "needsInputRounds": 1
}
```

`404` when the run does not exist or has no pending question.

```json
// POST /api/runs/proc_1/respond
{
  "answer": "PostgreSQL 14",
  "approvedInferences": ["Kubernetes"],
  "rejectedInferences": ["Terraform"],
  "coverLetterGuidance": null,
  "includeCoverInCv": "auto"
}
```

Answers **`202 { "runId": "proc_1" }`** and resumes generation in the same checkpoint. Errors:

| Code | When |
|---|---|
| `404` | Unknown run, or the run is not waiting |
| `409` | The run is not in `needs_input` |
| `400` | Empty answer for a `missing_fact` question |
| `400` | Approval of an inference the LLM did not offer (only `confidence: "high"`) |

`clarificationHistory` keeps the **last 2** entries, each answer capped at **2000** chars.

## 4.3 Regeneration — `POST /api/jobs/:id/regenerate`

Answers **`202 { "runId": "proc_..." }`**. Re-scrapes the posting (or reuses `job_posting.md`)
and rebuilds the kit in a new `_N` folder, preserving `id`, `status`, `appliedAt` and `createdAt`
while inheriting the application questions, the recruiter message and the missing extras.

`404` for an unknown job, `400` without a snapshot or pasted text, `409` when the required
language conflicts with the explicit one.

## 4.4 Base resume upload — `POST /api/profiles/:stack/:language/upload`

`multipart/form-data` with the file in the `resumeFile` field, up to **10 MB**. PDFs are read with
`pdftotext -layout` (`poppler-utils`); `.txt`, `.md` and `.html` are read as UTF-8. The upload
stays in memory (nothing is written to disk) and only the extracted text is persisted:

```json
{
  "sourceFile": "curriculo.pdf",
  "language": "pt-br",
  "stack": "ruby",
  "extractedAt": "2026-11-15T12:00:00.000Z",
  "rawLength": 4821,
  "rawText": "..."
}
```

The profile's `enabled` and `extraPrompt` are preserved. `400` without a file or with an invalid
stack/language, `413` above 10 MB, `422` when nothing can be extracted.

## 4.5 Assisted pre-fill — `POST /api/jobs/:id/prefill`

Dry-run only: fills the standard fields, attaches the job's `cv_pdf` artifact, captures
`preview_before_submit.png` and writes `application_dry_run_report.json` in the job folder. It
**never** clicks, submits or presses anything. Synchronous (the report is the point) and needs
Chromium; `poppler` is not involved.

```json
{ "applyUrl": "https://boards.greenhouse.io/acme/jobs/1/apply", "candidateData": { "email": "you@example.com" } }
```

```json
{
  "success": true,
  "prefill": {
    "status": "AGUARDANDO_APROVACAO_HUMANA",
    "filledFields": [{ "field": "Email", "selector": "input[type="email"]", "value": "you@example.com" }],
    "resumeAttached": true,
    "submitButtonDetected": { "text": "Enviar candidatura", "visible": true },
    "screenshotUrl": "/applications/acme_engineer/preview_before_submit.png",
    "reportUrl": "/applications/acme_engineer/application_dry_run_report.json",
    "notice": "NENHUMA submissão foi realizada..."
  }
}
```

`applyUrl` falls back to the job's `applyUrl`/`vacancyUrl`; `candidateData` is merged over the
derived candidate and persisted in `settings.candidate_form`. `404` for an unknown job, `400`
without a URL or without a CV PDF artifact.

## 4.6 Application questions — `POST /api/jobs/:id/questions`

Scrapes the application form (Greenhouse, Lever, Workable or generic), separates the standard
fields from the company questions, categorizes them (`upload`, `personal`, `legal`, `demographic`,
`custom`) and writes `application_questions.json` in the job folder. Synchronous, needs Chromium.

```json
{
  "success": true,
  "platform": "greenhouse",
  "questions": [
    {
      "id": "q_years",
      "label": "How many years of Rails experience?",
      "type": "select",
      "required": true,
      "options": ["1-3", "3-5"],
      "name": "question_1",
      "category": "custom"
    }
  ],
  "standardFields": [{ "id": "email", "label": "Email", "type": "email" }],
  "questionsUrl": "/applications/acme_engineer/application_questions.json"
}
```

`404` for an unknown job, `400` without a URL, `400` when the job has no kit folder yet.

## 4.7 Post-response chat — `POST /api/jobs/:id/chat`

Free conversation about a job **after** the pipeline answered. Synchronous (the handler awaits the
LLM and returns the whole reply), like `/prefill` and `/questions`; it does not go through the 202
queue. See [ADR-0011](./adr/0011-post-response-chat.md).

```json
{ "message": "Resuma o fit." }
```

```json
{
  "success": true,
  "reply": "Aderência alta, com um gap em Kubernetes.",
  "chat": [
    { "role": "user", "content": "Resuma o fit.", "at": "2026-11-15T12:00:00.000Z" },
    { "role": "assistant", "content": "Aderência alta, com um gap em Kubernetes.", "at": "2026-11-15T12:00:01.000Z" }
  ]
}
```

- **Context:** the latest `jobSnapshot.content` (scraped posting), the fit (rating, dimensions,
  strengths, gaps, analysis) and the last **12** turns. The zero-lies instruction and the skill's
  safety protocol are always injected in the system prompt.
- **Persistence:** the thread lives in `jobs.chat_history`, one per job, so it survives fit/kit
  reruns and `regenerate`.
- **Gates:** `404` unknown job, `400` blank message, `409` when there is neither a snapshot nor a
  fit.
- **Failures:** a failed LLM call persists nothing and answers a generic `500`; provider errors
  are redacted (`sk-…`, `key=…`) before they can reach the client.
- Quick actions in the UI are just predefined messages sent to this route; they never rewrite
  artifacts (that remains `POST /api/jobs/:id/regenerate`).

## 5. Legacy compatibility

These routes exist so the legacy UI keeps working during the migration. They
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
- `recruiterNoteFile` and `linkedInNoteFile` fall back to each other, as in the legacy app.
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

### `POST /api/applications/:id/apply-confirm`

v1 shim for the manual confirmation. It delegates to the same helper as
`POST /api/jobs/:id/apply-confirm`, so it writes the same `jobs` columns and enforces the same
`approved: true` lock. The envelope keeps the v1 shape:

```json
{ "success": true, "application": { "id": "app_1", "status": "applied", "applyMethod": "manual", "applyNote": "...", "date": "15/11/2026" } }
```

`404` for an unknown application, `400` without the explicit approval.

### `GET /api/processes`

Lists **only runs with `stage != "done"`** — that's what the legacy panel shows as pending
checkpoints. The DTO keeps `job`, `jobSnapshot`, `applicationId` and the flattened fit.

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
| GET | `/api/candidate-data` | `{ success, candidate }` — contact fields derived from the base resume text, with the saved form filling the blanks |
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
- **`/api/base-resumes`** keeps the legacy format (4 fixed keys) for the legacy UI; the new screen
  uses `/api/profiles`.

### LLM configuration — `/api/llm-config`

| Method | Route | Description |
|---|---|---|
| GET | `/api/llm-config` | `{ provider, model, baseUrl, temperature, top_p, maxTokens, hasKey, maskedKey }` — the key itself is never returned |
| PUT/POST | `/api/llm-config` | Partial update; returns `{ success, message }`. `POST` is an alias for the legacy UI |

- Stored in `settings` under the key `llm_config`. The local database keeps the saved key; the API
  exposes it only masked (`ABCDEF...WXYZ`).
- Partial semantics: missing fields keep their current value; `null` clears a sampling field;
  `apiKey: ""` keeps the current key (parity with the legacy UI, which resends an empty field when
  the user did not change the key).
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

# Legacy format
curl http://localhost:3344/api/applications

# Rendered resume
open http://localhost:3344/cv/app_1
```

## 9. Pipeline parity

The v1 pipeline is ported end to end: async `POST /api/fit-check`, deterministic
`POST /api/evaluate-fit`, Playwright scraping, the hybrid fit engine, the LLM fit check,
`POST /api/generate-kit`, the interactive queue, `POST /api/jobs/:id/regenerate` and the base
resume upload. The LLM client, the skill prompt loader and `/api/llm-config` live in
`src/pipeline/`.

Intentionally **not** ported (see [roadmap.md](./roadmap.md)):

- `render_pdf.mjs` page counting (cosmetic wrapper);
- `calculateFitHybridSync`, which is broken in v1;
- automated form submission (the app never clicks Submit; apply confirmation is manual).

See [architecture.md §7](./architecture.md#7-pipeline-llm-and-skills) and the phase goals in
[roadmap.md](./roadmap.md).
