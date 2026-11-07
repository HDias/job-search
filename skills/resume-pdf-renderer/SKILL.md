---
name: resume-pdf-renderer
description: >-
  Renders the resume PDF from the kit's HTML (layout B, single column
  + identity band per stack) with deterministic validation and ATS
  verification. Never changes the kit's text — layout only. Fails with
  violations instead of silently fixing things.
---

# resume-pdf-renderer

Separates **"what the CV says"** (the kit from `job-application-tailor`) from
**"how the PDF looks"** (this skill). Input is ready HTML; output is PDF + ATS
layer + violations report.

## Inputs

```json
{
  "resumeHtml": "<!DOCTYPE html>... (the kit's tailoredResumeHtml)",
  "language": "pt-br | en",
  "stack": "ruby | php",
  "accentColor": "#B56A6A",
  "cssVersion": "b1"
}
```

- `accentColor`: the band's active color for the stack (defaults: Ruby `#B56A6A`,
  PHP `#4F5B93`; editable in the Admin tab, persisted in `base_profile/pdf-theme.json`).
- Alternative to `resumeHtml`: `resumeData` + `templates/resume_structure.html`
  (`{{...}}` tokens) for deterministic assembly without an LLM.

## Outputs

```json
{
  "pdfPath": ".../Horecio-Dias-<Vaga>.pdf",
  "atsLayerPath": "..._ats_layer.txt",
  "pageCount": 2,
  "charCount": 4200,
  "violations": []
}
```

## Rules (non-negotiable)

1. **Never alter the kit's text** — layout only (CSS/band/margins). Changing a
   word, a number, or a company = critical violation.
2. **Identity band**: exactly 1 `.accent` per document, color =
   `accentColor` of the stack. See `references/layout_spec.md`.
3. **ATS**: single column, no `<link>`/`<img>`/remote fonts, standard fonts,
   A4 margins. See `references/ats_constraints.md`.
4. **Fail with `violations`** instead of "silently fixing". The caller
   (`job_processor.mjs`) decides retry (max 2 attempts) or manual acceptance.
5. `render_pdf.mjs` is a thin wrapper of the sister skill's `generate_pdf.mjs` —
   it does not duplicate the Playwright engine.

## Scripts

- `scripts/validate_resume_html.mjs` — checks required classes, single
  column, band present with the stack's color, no external assets, limits
  (size, pages). Usage:
  `node scripts/validate_resume_html.mjs <resume.html> [--stack ruby|php] [--accent #HEX] [--json]`
- `scripts/render_pdf.mjs` — wrapper of `generate_pdf.mjs` + page count
  + report. Usage:
  `node scripts/render_pdf.mjs <resume.html> <saida.pdf> [--stack ruby|php]`

## Integration

`job_processor.mjs` (phase 2): after receiving `tailoredResumeHtml`, runs
`validate_resume_html.mjs` with the stack's configured color; if there are
`violations`, re-injects a targeted fix into the LLM (max N=2) instead of
accepting directly. Color persistence: `GET/PUT /api/pdf-theme`
(`base_profile/pdf-theme.json`).
