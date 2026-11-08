# Writing Guidelines: Real-Fact Principle (No Lies)

This guide governs how the base resume is adapted to the target job.

## 1. The Interview Backtrack Test
Before adding or rewriting any line or bullet point in the resume, apply the test:
> *"If the recruiter or tech lead asked about this point in the interview, could the candidate answer with confidence and real details, without having to say 'well, actually it wasn't quite that...'?"*
- If the answer is **yes** -> The bullet is legitimate.
- If the answer is **no** -> It is a distortion or an invention. **DO NOT INCLUDE.**

## 2. Reframing vs. Fabrication

| Allowed (Legitimate Reframing) | FORBIDDEN (Fabrication / Lie) |
|---|---|
| Reorder experiences to highlight first the ones most relevant to the job. | Invent roles, companies, dates or projects that never existed. |
| Use terms and keywords from the job posting to describe technologies the candidate actually used (e.g.: if the candidate used Docker and the job posting asks for "Conteinerização", use "Conteinerização com Docker"). | Include languages, frameworks or tools the candidate never used. |
| Emphasize real quantitative achievements (performance metrics, data volume, time savings) already documented in the base profile. | Inflate metrics or invent numbers without backing in the base resume. |
| Explain skill adjacency when there is a gap (e.g.: "Conhecimento avançado em Python e arquitetura de dados, com facilidade para transição imediata para PySpark"). | Pretend to have years of experience in a knockout requirement the candidate does not master. |

## 3. How to Handle Requirement Gaps
- **Never insert keywords blindly (Keyword Stuffing).** Modern ATSs and interviewers easily identify loose terms without practical context.
- If the job posting asks for a technology the candidate does not have:
  1. Leave the gap visible and honest.
  2. Highlight an analogous technology the candidate strongly masters (e.g.: strong AWS mastery instead of pretending to have GCP).
  3. In the summary or cover letter (if applicable), mention learning ease and real side projects.

## 4. Style and Tone Rules
- **Active, impact-oriented voice:** start each bullet with a strong action verb ("Desenvolveu", "Implementou", "Otimizou", "Liderou").
- **Avoid empty clichés:** cut phrases such as "profissional apaixonado", "focado em resultados", "pensamento fora da caixa", "proven ability", "proven track record", "results-driven", "seasoned", "self-starter", "team player". Replace them with concrete facts. (List verified by script after generating — presence = generation failure.)
- **Conciseness:** keep the resume focused in at most 1 to 2 pages.

## 5. Experience Selection (applies to ALL jobs)
- List with full bullets (3-4 bullets each) only the 5-6 most relevant roles, prioritizing recent ones (2019+) and those from the job's stack.
- Required MINIMUMS: 4-5 roles with bullets covering 2019→present without holes; 10-12 skills in Highlights; 3-4-line Summary. Aim for 2 full pages — never fewer than 4 roles or 10 skills.
- Older roles (e.g.: 2012-2018) go condensed into 1 "Early Career" block — role/company/period only, WITHOUT bullets. Do not erase years, only condense.
- Total career time appears in the Summary ("9+ anos"), never detailing junior roles with full bullets.
- For Staff/Principal/Lead roles: prioritize bullets about scale, technical leadership, modernization and ownership in production.

## 6. Bullet and Summary Engineering (the recruiter's eye)
- Target title with the exact wording of the job posting, never generic.
- Summary = seniority + stack + 1-2 scale proofs WITH real numbers from the CV + the job posting's differentiator. No clichés without proof.
- Bullets = strong verb + scope/scale + outcome; first bullet of each role = scope (system, team, volume). No empty adverb without a number.
- Highlights mirror the job posting's keywords with specific tool names; no generic label.
- Numbers only the ones documented in the base resume — mining the CV for real metrics is mandatory, inventing is forbidden.

## 7. Education & Certifications (MANDATORY — always include)
- The "Education & Certifications" (EN) or "Formação & Certificações" (PT-BR) section **MUST ALWAYS** be included in the tailored resume.
- **Academic education:** Extract from the Base Resume (undergraduate, postgraduate, master's, etc.) with institution and period.
- **Professional certifications:** Extract ALL certifications listed in the Base Resume (sidebar or dedicated section). Real examples from the profile: "Ruby on Rails 5.x - Do início ao fim!", "SOLID Principles: Introducing Software Architecture & Design", "TDD com Ruby on Rails, RSpec e Capybara", "Docker para desenvolvedores Ruby on Rails", "Ember.js Bootcamp 2023", "AI for Devs", etc.
- HTML structure for each certification:
  ```html
  <div class="edu-entry">
    <div class="edu-degree">Certification name</div>
    <div class="edu-school">Certification</div>
  </div>
  ```
- **NEVER OMIT certifications** — they demonstrate continuous learning and are valued by recruiters and ATSs.
- If there are no certifications in the Base Resume, include only the academic education.

## 8. Languages Footer (MANDATORY — fixed structure)
- The footer **MUST** use exactly this structure (no internal heading):
  - PT-BR: `<footer class="languages"><div>Português (Nativo)</div><div>Inglês (Profissional)</div></footer>`
  - EN: `<footer class="languages"><div>Portuguese (Native)</div><div>English (Professional Working)</div></footer>`
- **FORBIDDEN** to use `<h2>`, `<h3>` or any heading inside the footer — only `<div>` with the languages, one per line.
- The `languages` class in the footer is used by the online viewer CSS and the ATS layout; a heading inside breaks the visual layout and the text extraction.

## 10. Staged Method and Evidence Density
- Internal stages: 1-Candidate (only the base exists) → 2-Job (trust the script's coverage) → 3-Mapping (1 requirement = 1 real evidence) → 4-Prioritization (strongest first; the initial 10-20s answer seniority, Rails, data, production, testing, AI, domain) → 5-Writing → 6-Validation (each claim against the base and against the vetoes).
- Evidence density: ACTION + TECHNOLOGY + PROBLEM/CONTEXT + RESULT/IMPACT when the base supports it; with no real number, SCOPE (system, team, users, volume) — never an invented metric to fill the formula.
- Do not maximize keyword density; maximize evidence density. A term without practical context is keyword stuffing (§3).
- **Mandatory coverage:** every technical term present IN THE JOB POSTING AND IN THE BASE (genuine match computed by script) MUST appear in the kit with real context — never loose. Absence = generation failure with retry. Tailoring toward the job is reordering and reframing, never subtracting matches.
- **Grounding vetoes:** a term the job posting cites but the base does NOT have is FORBIDDEN in the kit (e.g.: the job asks for Terraform, the base doesn't have it → don't even mention it). Presence = hallucination, failure with retry for removal.
- **Preserved core:** the candidate's signature tools (5+ mentions in the base) stay in the Highlights even if the job does not cite them. The cap of 5-6 roles with bullets does NOT authorize removing tools from the Highlights — condense roles, not the arsenal.
- **Ammo:** every number in the kit comes from the ammo/base; if no number from the ammo appears in the kit, the generation fails (ammo ignored).
