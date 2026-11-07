# layout_spec.md — Layout B (ATS + identity)

Extracted from `docs/pdf-sugestoes/sugestao-B-ats-identidade.html` + `resume_style.css`.

- Document: single column. `.page` container (or legacy `.resume-container`),
  `max-width: 800px`, `margin: 0 auto`, padding `32px 36px`.
- Identity band: `div.accent` as the **first child of `body`**,
  `height: 8px`, `background: var(--accent, #B56A6A)`.
  Exactly 1 per document. Color = `accentColor` of the stack
  (Ruby `#B56A6A` / PHP `#4F5B93` by default).
- Typography: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`.
  Name `.name`/`h1.candidate-name` 28–32px weight 600; section titles
  `.section-title`/`h2.section-title` 16–18px weight 600, `border-top: 2px solid var(--accent)`,
  `padding-top: 12px`, `margin: 26px 0 10px`.
- Section order: Summary → Highlights → Experience → Education & Certifications.
  Education/languages in a 2-col block that is **textual only at the end** (`.two-col`
  via `display: table`, never real CSS multicolumn nor a floating sidebar).
- Highlights: `.skills` with `.skill` pills (`background: #f3f3f3`,
  `padding: 4px 10px`, `border-radius: 4px`) OR a `.skills` paragraph with
  `<strong>Category:</strong>` + `&nbsp;|&nbsp;` — both accepted by the validator.
- Experience: each position `.job` or `.job-entry` with `.company`/`.job-company`,
  `.role`/`.job-title`, `.dates`/`.job-meta` (italic, `#666`), `ul` with bullets.
- Links: color `var(--accent-dark, #9E4A4A)` or legacy `#2563eb`; no underline
  in print (`@media print a { color: inherit; text-decoration: none; }`).
- Page: `@page { size: A4; margin: 14mm 15mm; }`.
  Print: `.accent { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`.
- Required classes (the validator accepts B ↔ legacy aliases):
  `resume-container|page`, `candidate-name|name`, `target-title|headline`,
  `location-line|contact`, `contact-info|contact`, `section-title`,
  `summary-text|summary`, `skills`, `skill` (optional if skills are in a paragraph),
  `job-entry|job`, `job-company|company`, `job-meta|dates`,
  any `<ul>` counts as `bullet-list`, `edu-entry|two-col`.
  Optional (warning only): `location-line`, `skill`, `job-title|role|h3`,
  `edu-degree`, `edu-school`, `languages`.
  `languages`.
