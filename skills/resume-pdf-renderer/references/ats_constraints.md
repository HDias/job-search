# ats_constraints.md — ATS Constraints

- Single column with vertical flow. Forbidden: real multi-column CSS
  (`column-count`, `columns`), side-by-side floats for main content,
  `position: absolute` for relevant text.
- Exception: the textual `.two-col` at the end (Education/Languages) via
  `display: table` — two 50% `table-cell`s — is parser-safe (verified via
  `pdftotext -layout` on the reference layout B).
- No images of text: no `<img>`, no text in canvas/SVG.
- No external assets: no `<link>`, `@import`, `url(http...)`,
  remote fonts. All CSS embedded in `<style>`.
- Fonts: system stack (`-apple-system, Segoe UI, Helvetica, Arial,
  sans-serif`). No webfont.
- Semantics: `h1` name, `h2` sections, `ul/li` bullets, real text
  (not `::before/::after` carrying relevant content).
- PDF via Playwright `page.pdf({ format: A4, margins 15mm, printBackground: true })`.
- Verification: `pdftotext -layout -enc UTF-8` → `*_ats_layer.txt`;
  `atsCompatible = charCount > 100` (objective failure threshold).
