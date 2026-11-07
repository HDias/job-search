# Application Question Category Taxonomy

This documentation defines the standard categorization for questions extracted from application forms (ATS). Used by `question_suggestion_engine.mjs` to determine the suggestion-generation strategy.

---

## Main Categories

### 1. `personal` - Personal identification fields
Standard fields present in most forms.

**Examples:**
- First Name, Last Name, Full Name, Preferred Name
- Email, Phone, Mobile, Telephone
- Address, City, State, ZIP/Postal Code, Country
- LinkedIn Profile, GitHub, Portfolio, Website

**Suggestion strategy:** Direct mapping from `personalInfo` in the base profile.
**Confidence:** High (high)

---

### 2. `upload` - File attachments
Fields for document uploads.

**Examples:**
- Resume / CV (almost always mandatory)
- Cover Letter (optional)
- Portfolio, Certificates, Transcripts, Work Samples

**Suggestion strategy:** Reference the generated PDF files (`curriculo_direcionado.pdf`, `cover_letter.pdf`).
**Confidence:** High (high)

---

### 3. `custom` - Company-specific questions
Questions created by the company for this specific job posting. They vary widely.

**Common subtypes:**

#### Technical / experience
- "What is your experience working with distributed systems at scale?"
- "Describe your experience with Ruby on Rails"
- "Rate your proficiency in Kubernetes"
- "Walk us through a challenging debugging scenario"

#### Behavioral / situational
- "Tell us about a time when you had to refactor legacy code"
- "Describe a situation where you disagreed with a technical decision"
- "How do you handle competing priorities?"

#### Motivation / cultural fit
- "Why do you want to work at [Company]?"
- "What interests you about this role?"
- "How do you stay current with technology trends?"

**Suggestion strategy:**
1. Extract keywords from the question
2. Find matches in the profile (experience bullets, skills, projects)
3. Compose a factual answer based on real evidence
4. Include profile references for auditing

**Confidence:** Medium to High (medium/high) depending on the matches found

---

### 4. `legal` - Legal compliance and authorization
Questions related to legal requirements, visas, data consent.

**Examples:**
- "Are you currently authorized to work for any employer in the USA?"
- "Do you require visa sponsorship now or in the future?"
- "Are you a citizen/permanent resident of [Country]?"
- "Consent to data processing for this application (GDPR/LGPD)"
- "Consent to data processing for future opportunities"
- "Background check authorization"
- "Have you worked for [Company] in the past?"
- "Have you interviewed with [Company] before?"

**Suggestion strategy:**
- Based on `personalInfo.citizenship`, `personalInfo.workAuthorization`, `personalInfo.location`
- **Golden rule:** ALWAYS answer truthfully
- Include warnings for sensitive questions
- If authorization/citizenship is not explicit, leave unanswered with confidence `low` and require manual input
- Consent, terms, background check and retention for future roles are the user's decisions: never check or suggest "Yes" automatically

**Confidence:** High (`high`) only when the legal answer is explicit in the profile; low (`low`) when absent or when it requires a user decision/consent

---

### 5. `demographic` - Demographic data (EEO - Equal Employment Opportunity)
Voluntary questions for diversity reporting. They **never** affect the hiring decision.

**Examples:**
- Gender / Sex
- Race / Ethnicity
- Veteran Status
- Disability Status
- Sexual Orientation
- Transgender Identity
- Hispanic/Latino Origin

**Characteristics:**
- Always marked as "Voluntary" / "Optional" / "EEO"
- Frequently grouped at the end of the form
- A "Prefer not to answer" or "Select..." option is always present

**Suggestion strategy:** Default "Prefer not to answer" for all.
**Confidence:** High (high) - it is the safe default recommendation

---

## Automatic Detection (Heuristic)

`question_suggestion_engine.mjs` uses keywords to categorize automatically:

### Keywords for `custom`
```
experience with, knowledge of, familiar with, proficiency in
describe, explain, tell us about, walk us through
project, challenge, situation, example
why [company], why this role, interest in
rate your, how would you, approach to
```

### Keywords for `legal`
```
authorized to work, work authorization, visa, sponsorship
citizen, permanent resident, green card, citizenship
consent, privacy, data processing, gdpr, lgpd
background check, drug test, criminal record
worked for.*in the past, interviewed with.*in the past
```

### Keywords for `demographic`
```
gender, race, ethnicity, veteran, disability
sexual orientation, transgender, hispanic, latino
voluntary, optional, self-identification, eeo
prefer not to answer
```

### Keywords for `personal`
```
first name, last name, full name, preferred name
email, phone, mobile, telephone
address, city, state, zip, postal code, country
linkedin, github, portfolio, website
```

### Keywords for `upload`
```
resume, cv, curriculum, cover letter
attach, upload, file
```

---

## Handling by Field Type

| HTML type | Common categories | Handling |
|-----------|-------------------|----------|
| `text` | personal, custom, legal | Direct mapping or text generation |
| `email` | personal | Direct mapping |
| `tel` | personal | Direct mapping |
| `select` | legal, demographic, custom | Option matching |
| `radio` | legal, demographic, custom | Option matching |
| `checkbox` | legal, custom | Boolean suggestion |
| `textarea` | custom | Text generation |
| `file` | upload | File reference |

---

## Confidence Levels

| Level | Criterion | Recommended action |
|-------|----------|------------------|
| `high` | Direct 1:1 mapping from the profile; clear business rule | Use directly |
| `medium` | Composition of multiple profile sections; some inference | Review before use |
| `low` | Subjective open question; no data in the profile; personal decision | Manual filling is mandatory |

In `customQuestions`, `legalQuestions` and `demographicQuestions`, store
`value`, `source`, `confidence`, `notes` and `profileReferences` inside
`suggestion`. In `fieldMappings`, the map value itself uses these fields.

---

## Mapping Examples

### Question: "What is your experience working with distributed systems at scale?"
- **Category:** `custom` (technical)
- **Keywords:** distributed, systems, scale
- **Matches in the profile:**
  - experience[0].bullets: "Architected microservices handling 100k+ req/min using Kafka..."
  - experience[1].bullets: "Deployed on AWS with Kubernetes (EKS), implemented circuit breakers..."
  - skills.distributedSystems: 5
- **Suggestion:** composed answer with 5+ years, specific technologies, real metrics
- **Confidence:** high
- **References:** included in the JSON for auditing

### Question: "Are you authorized to work in the US?"
- **Category:** `legal`
- **Profile data:** citizenship: ["Brazilian"], location: "Sao Paulo, Brazil"
- **Suggestion:** "No - Brazilian citizen residing in Brazil. Role is remote for Brazil."
- **Confidence:** high
- **Warning:** included about the legal consequences of falsification

### Question: "Gender"
- **Category:** `demographic`
- **Suggestion:** "Prefer not to answer"
- **Confidence:** high

---

## Extensibility

To add a new category:
1. Add keywords in `categorizeQuestion()` in the engine
2. Add a case in the `generateSuggestions()` switch
3. Document it here with examples
4. Test with real forms

---

## References

- EEOC Guidelines: https://www.eeoc.gov/employers/eeo-survey
- GDPR Art. 7: Conditions for consent
- LGPD Art. 7: Hipóteses de tratamento de dados pessoais
- Greenhouse/Lever/Workable field type documentation
