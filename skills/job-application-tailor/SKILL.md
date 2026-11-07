---
name: job-application-tailor
description: >-
  Analyzes a job posting against the base resume and returns lie-free guidance
  (fit, resume, cover letter, email, LinkedIn, suggested answers) as structured
  data. Supports PT-BR and English, with mandatory human approval before any
  application.
---

# Job Application Tailor

This skill analyzes a job posting against the base resume and produces targeted
application materials that are factually defensible and ready for review.

---

## Inputs

- `vacancy`: `{ title, company, url, applyUrl, detectedLanguage, content }`.
- `baseProfile`: `{ rawText, language }` (base resume, the ONLY source of facts).
- `language`: `pt-br` or `en` — the language confirmed by the user for the materials.
- `questions` (optional): list of form questions/fields already extracted.
- `fitSnapshot` (optional, phase 2): fit already approved by the user.
- `coverLetterGuidance` (optional): user guidance for the cover letter
  (tone/emphasis). It becomes a style instruction in the prompt — NEVER a source
  of facts; grounding stays in the base profile.

If `language` is missing or ambiguous, ask for confirmation before generating
materials (do not assume):

> *"A vaga foi identificada em [Português / Inglês]. O currículo deve ser gerado em Português (PT-BR) ou Inglês?"*

---

## Outputs

### A. Fit check — job posting × profile assessment

Evaluate according to `references/evaluation_framework.md`
(Eligibility Gate, Language Gate, Skills, Experience, Logistics, Culture).
Evaluate the Eligibility Gate first. If it fails, stop: do not compute the
dimensions, do not present a compatibility table and do not generate materials. Keep
the numeric fields as `0` only for schema compatibility and explain in
`fitAnalysis` that no scoring took place due to ineligibility. Return exactly
this JSON (no markdown around it, when requested):

```json
{
  "company": "Cleaned company name",
  "role": "Role title",
  "eligibility": { "passed": true, "reason": "..." },
  "languageGate": { "required": "pt-br|en", "passed": true, "note": "..." },
  "skillsMatch": 0,
  "experienceMatch": 0,
  "logisticsMatch": 0,
  "cultureMatch": 0,
  "fitRating": 0,
  "fitAnalysis": "2-3 sentences: technical compatibility + honest gaps",
  "strengths": ["..."],
  "gaps": ["..."],
  "recommendation": "proceed | proceed_with_focus | ask_user"
}
```

Also present a readable compatibility table and ask:

> *"Deseja prosseguir com a elaboração do currículo direcionado para esta vaga?"*

If the user says no, stop here.

### B. Tailored kit — resume + outreach

Consult `references/writing_style_guide.md` and, for the email,
`references/email_style_guide.md`. Return exactly ONE of the two formats
(valid JSON, no markdown around it):

**1. Complete kit:**

```json
{
  "company": "...",
  "role": "...",
  "fitRating": 0,
  "fitAnalysis": "...",
  "tailoredResumeHtml": "<!DOCTYPE html>... complete resume in the approved language ...</html>",
  "coverLetterHtml": "<!DOCTYPE html>... company-first letter ...</html>",
  "emailSubject": "...",
  "emailBody": "...",
  "emailNotes": "which signals from the job posting guided the personalization",
  "linkedInConnectionNote": "<= 300 characters",
  "linkedInInMail": "100-150 words"
}
```

**2. Input request (interactive queue — only when a missing piece of data BLOCKS the kit):**

```json
{ "needsInput": true, "kind": "missing_fact", "question": "...", "options": ["..."], "blockingField": "..." }
```

or, for inference approval:

```json
{ "needsInput": true, "kind": "inference_approval",
  "question": "Posso listar S3 e EC2 (inferidos de AWS no seu perfil)?",
  "inferences": [
    { "skill": "S3", "inferredFrom": "AWS", "confidence": "high" },
    { "skill": "EC2", "inferredFrom": "AWS", "confidence": "high" }
  ],
  "blockingField": "tailoredResumeHtml:Highlights" }
```

Rules: `needsInput` only for missing data that prevents the kit (e.g.: a form
field with no evidence in the profile). Never to invent a fact. Mixing is
forbidden: either the kit, or `needsInput`. No text outside the JSON. Max 2
`needsInput` rounds per generation; max 5 inferences per round.

**Inference policy (zero-lies, extended):** allowed to infer ONLY child
sub-skills of a parent technology explicit in the base profile (e.g.:
`AWS→S3/EC2/RDS`, `Rails→ActiveRecord/Sidekiq`). Every inference declares
`inferredFrom` + `confidence` (`high` = direct and ubiquitous child; below
that, don't even propose — conservative default). Still forbidden to infer
metrics, years of experience, companies, roles, dates, certifications,
seniority. No numeric inference whatsoever. Golden rule: an inference never
enters the kit silently — only via explicit user approval in the interactive
queue. Rejected = forbidden on resume.

Rules: the EXACT wording of the job posting's title in `target-title`; 3-4-line
Summary with numbered evidence from the profile; 3-4 bullets per role with
scope + outcome; Highlights mirroring the job posting's real keywords; the
Education & Certifications section is always included. Mandatory coverage +
vetoes computed by script (`extractCoverageTerms`) count as required
presence/absence in the HTML, with retry. **ZERO inventions** — see details
below.

**Cover letter inside the CV (combined variant):** when the job posting asks for
the letter INSIDE the CV / in the same file (e.g.: "upload your CV including a cover
letter"), the pipeline generates `curriculo_direcionado_com_cover.html/.pdf` with the
cover letter as the FIRST section (after the `.accent` band, with a page-break so the
CV starts on a new page) — detected
by `detectCoverLetterInCvRequirement` or forced via `includeCoverInCv: true`.
The separate `cover_letter.html/.pdf` is ALWAYS kept. "Cover letter required"
alone (separate files) does NOT trigger the variant.

### C. Form answer suggestions

When `questions` is provided, map each question against the profile and return:

```json
{
  "fieldMappings": { "<fieldId>": { "value": "...", "source": "...", "confidence": "high|medium|low", "notes": "..." } },
  "customQuestions": [{ "id": "...", "label": "...", "suggestion": { "value": "...", "source": "...", "confidence": "high|medium|low", "notes": "...", "profileReferences": ["..."] } }],
  "legalQuestions": [{ "id": "...", "label": "...", "suggestion": { "value": "...", "source": "...", "confidence": "high|medium|low", "notes": "...", "profileReferences": ["..."] } }],
  "demographicQuestions": [{ "id": "...", "label": "...", "suggestion": { "value": "Prefer not to answer", "source": "demographic_default", "confidence": "high", "notes": "...", "profileReferences": [] } }]
}
```

Map each question exactly once. `confidence` always lives inside `suggestion`
(or directly in the `fieldMappings` value, which already is the suggestion).
When the answer is not in the profile, use an empty value, `source` equal to
`manual_input_required`, confidence `low`, and request manual review. For
voluntary demographic/EEO questions, suggest `"Prefer not to answer"`. Legal
questions (work authorization, consent): answer with strict truth only when
there is explicit evidence. Consent is the user's decision, not an inferable
fact. Confidence `low` = requires manual review/input — never invent or accept
terms on the user's behalf.

---

## Domain Rules (Normative Details in `references/`)

- **Zero lies (non-negotiable):** no company, role, date, metric, tool or
  language beyond the base profile. Every bullet passes the "Interview
  Backtrack Test". Reframe real facts with the job posting's keywords only
  where there is a genuine match. Missing differentiator = "não demonstrado",
  never "sem experiência".
- **Language:** materials in the confirmed language; if the job posting demands
  an explicit language, do not generate in another.
- **Human-in-the-loop (non-negotiable):** never authorize or carry out an
  application without the user's explicit review and approval. See
  `references/human_in_the_loop_safety.md`.
