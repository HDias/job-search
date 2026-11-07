# Answer Suggestions - Application Form

**Job:** {{role}} - {{company}}
**Date:** {{date}}
**Source:** {{applicationUrl}}
**Base profile:** {{profileUsed}}

---

## ⚠️ IMPORTANT - READ BEFORE USING

> **These are SUGGESTIONS based on your base profile.**
> **Do NOT send without reviewing.** Check each answer for:
> - ✅ Factual accuracy (dates, companies, technologies)
> - ✅ Fit with the specific question
> - ✅ Appropriate tone and level of detail
> - ❌ Do NOT invent information not present in your profile

---

## Standard Fields (Automatic Filling)

| Field | Suggestion | Profile source |
|-------|----------|-----------------|
| First Name* | {{firstName}} | personalInfo.firstName |
| Last Name* | {{lastName}} | personalInfo.lastName |
| Email* | {{email}} | personalInfo.email |
| Phone | {{phone}} | personalInfo.phone |
| LinkedIn Profile* | {{linkedin}} | personalInfo.linkedin |
| Resume/CV* | [Attach: curriculo_direcionado.pdf] | Generated file |
| Cover Letter | [Attach: cover_letter.pdf] | Generated file |

---

## Company-Specific Questions

{{#each customQuestions}}
### {{@index}}. {{label}}
**Type:** {{type}}
**Required:** {{required}}
**Suggestion:** {{suggestion.value}}
**Rationale:** {{suggestion.notes}}

{{#if suggestion.profileReferences}}
**Profile source:**
{{#each suggestion.profileReferences}}
- {{this}}
{{/each}}
{{/if}}

---
{{/each}}

## Legal / Compliance Questions

> ⚠️ **CRITICAL: Answer truthfully. Misrepresentation can have legal consequences.**

{{#each legalQuestions}}
### {{@index}}. {{label}}
**Type:** {{type}}
**Required:** {{required}}
**Suggestion:** {{suggestion.value}}
**Rationale:** {{suggestion.notes}}

{{#if suggestion.warning}}
> ⚠️ {{suggestion.warning}}
{{/if}}

---
{{/each}}

## Demographic Questions (Optional - EEO)

> **These questions are voluntary and do not affect the hiring process.**
> **Default suggestion:** "Prefer not to answer" / "Select..." for all of them.

| Question | Suggestion |
|----------|----------|
{{#each demographicQuestions}}
| {{label}} | {{suggestion.value}} |
{{/each}}

---

## Review Checklist

- [ ] All personal data verified
- [ ] LinkedIn URL is correct and accessible
- [ ] "Custom questions" answers reflect REAL experience
- [ ] Work authorization: honest answer aligned with the job
- [ ] English level: matches reality
- [ ] Consent checkboxes: marked according to your decision
- [ ] Demographic questions: answered according to personal comfort
- [ ] Attachment files (PDFs) ready for upload
