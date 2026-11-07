# Job Evaluation Framework (Fit Scoring)

Before generating any resume, the job posting must pass the evaluation criteria:

## 1. Eligibility Gate
- Nationality or Work Permit: Does the job posting require a specific citizenship or visa that the candidate does not have?
  - If YES -> **FAILED (immediate stop)**. Record the factual blockers and do not score the four dimensions, do not prepare materials and do not suggest applying.
- Security Clearance: If a clearance restricted to citizens is required, alert immediately.
- Absence of information is not a failure: when authorization, citizenship or clearance are not documented, mark as unknown and ask for human confirmation.
- Technical overlap never compensates for a failure in this gate.

## 2. Language Gate
- Does the job ad or the day-to-day work require a specific language?
- **Ask the user:**
  - "A vaga exige trabalho em Português (PT-BR) ou Inglês?"
  - "Em qual idioma você deseja que o currículo direcionado seja gerado?"
- If the candidate does not have the proficiency level required by the job posting for daily communication, alert before proceeding.

## 3. Scoring Dimensions (0 to 100)

Compute these dimensions only after the Eligibility Gate is passed.
When the gate fails, use `0` in the numeric fields only as a schema-compatibility
sentinel and write in `fitAnalysis` that the fit was not scored.

| Dimension | Weight | Description |
|---|---|---|
| **Technical Fit (Skills Match)** | 40% | How many of the must-have and nice-to-have requirements does the candidate verifiably possess? |
| **Experience Fit (Seniority/Domain)** | 30% | Does the candidate's career trajectory cover the responsibilities described for the role? |
| **Logistics & Work Model** | 20% | Remote, hybrid or on-site compatible with the candidate's location? |
| **Career & Culture Alignment** | 10% | Does the job posting contribute to the candidate's long-term goals? |

## 4. Verdict and User Decision
Present the table to the user:
- **Strong fit (>= 75%)**: recommend proceeding to resume tailoring.
- **Medium fit (50% - 74%)**: recommend proceeding with a focus on transferable skills.
- **Low fit (< 50%)**: alert the user about the considerable gaps and ask explicitly whether they still want to proceed.

## 5. Judgment Rules (anti-gap-hallucination)
- The app injects `PERFIL CALCULADO POR SCRIPT` (total time, stacks, evidence) and `REQUISITOS PRÉ-CLASSIFICADOS` (must-have vs differentiators). NEVER recompute time nor reclassify without reason: use the injected values.
- Critical gap ONLY on an explicit must-have with magnitude. Missing differentiator ("will help you succeed", "bonus", "nice to have") = partial fit ("não demonstrado"), NEVER "sem experiência".
- Scale without metrics in the CV = "não quantificado" (partial), never "sem experiência em escala".
- Each strength/gap must cite a fact from the profile/CV. `fitRating` must be consistent with the weighted average of the 4 dimensions.
- Anchors: main stack with 2+ blocks → skills ≥ 70 (below 50 forbidden); time ≥ required → exp ≥ 70 (overqualified never < 50); remote + eligible country → logistics ≥ 70; agile/multidisciplinary → culture baseline 60. No dimension < 20 without a blocking fact. Self-check: divergence > 10 points between fit and weighted average requires reviewing the numbers.
