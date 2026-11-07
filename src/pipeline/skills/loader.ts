import fs from 'node:fs';
import path from 'node:path';

/**
 * Port of v1's `skill_loader.mjs`. Loads the live skill content (SKILL.md +
 * references) to build the prompts — the app really "uses the skill" instead
 * of a hardcoded prompt disconnected from it.
 */

export interface SkillReferences {
  skillMd: string;
  evaluationFramework: string;
  writingStyleGuide: string;
  emailStyleGuide: string;
  safetyProtocol: string;
}

export interface SkillLoader {
  readonly skillDir: string;
  loadReferences(): SkillReferences;
  clearCache(): void;
  /** Phase-1 system prompt: job-fit evaluation (skill's Step 3). */
  buildFitSystemPrompt(): string;
  /** Phase-2 system prompt: tailoring (skill's Step 4 + style guides). */
  buildTailorSystemPrompt(): string;
  /** Email section of the generation prompt (skill's live email guide). */
  buildEmailSection(targetLang: string): string;
  /** Path to a skill template (resume_style.css etc.). */
  templatePath(name: string): string;
  readTemplate(name: string): string;
}

function safeRead(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(
      `[Skill] Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return '';
}

export function createSkillLoader(skillsDir: string): SkillLoader {
  const skillDir = path.join(skillsDir, 'job-application-tailor');
  const referencesDir = path.join(skillDir, 'references');
  const templatesDir = path.join(skillDir, 'templates');

  let cache: SkillReferences | null = null;

  return {
    skillDir,

    loadReferences() {
      if (cache) return cache;
      cache = {
        skillMd: safeRead(path.join(skillDir, 'SKILL.md')),
        evaluationFramework: safeRead(
          path.join(referencesDir, 'evaluation_framework.md'),
        ),
        writingStyleGuide: safeRead(
          path.join(referencesDir, 'writing_style_guide.md'),
        ),
        emailStyleGuide: safeRead(
          path.join(referencesDir, 'email_style_guide.md'),
        ),
        safetyProtocol: safeRead(
          path.join(referencesDir, 'human_in_the_loop_safety.md'),
        ),
      };
      return cache;
    },

    clearCache() {
      cache = null;
    },

    buildFitSystemPrompt() {
      const { evaluationFramework } = this.loadReferences();
      return `You are a job-to-candidate fit evaluator (executive recruiting + ATS).
SUPREME RULE: ZERO LIES — use ONLY facts from the Base Resume.
Follow this evaluation framework STRICTLY:
---
${evaluationFramework.slice(0, 6000)}
---
You MUST answer with valid JSON only, no markdown, no extra text.`;
    },

    buildTailorSystemPrompt() {
      const { writingStyleGuide, evaluationFramework } = this.loadReferences();
      return `You are an expert in executive recruiting, ATS analysis and high-impact resume engineering.
SUPREME RULE: ZERO LIES (STRICT GROUNDING).
- NEVER invent roles, companies, dates, degrees, metrics or tools absent from the Base Resume.
- Apply the "Interview Retraction Test": everything must be defensible in a real technical interview.
- REFRAME real facts with the job's keywords where there is a genuine match. NEVER keyword stuffing.
- You MUST answer with valid JSON only, no markdown, no extra text.
- FORMAT: either the complete kit (exactly the keys requested in the user prompt) or ONE input request:
  {"needsInput": true, "kind": "missing_fact|inference_approval", "question": "...", "options": ["..."], "blockingField": "...", "inferences": [{"skill": "...", "inferredFrom": "...", "confidence": "high"}]}.
- needsInput ONLY for missing data that blocks the kit (e.g.: form field with no evidence in the profile). Never to invent a fact. Mixing kit + needsInput is FORBIDDEN. Max 2 rounds.
- INFERENCE POLICY (extended zero-lies): allowed to infer ONLY child sub-skills of a parent technology explicit in the base profile (e.g.: AWS→S3/EC2/RDS, Rails→ActiveRecord/Sidekiq). Every inference declares inferredFrom + confidence (only "high" reaches the user; below that, don't even propose). Still FORBIDDEN to infer: metrics, years of experience, companies, roles, dates, certifications, seniority. No numeric inference. An inference never enters the kit silently — only through explicit user approval in the interactive queue; rejected = forbidden on resume (NEVER-list list).

Writing guide (MANDATORY):
---
${writingStyleGuide.slice(0, 6000)}
---

Evaluation framework (context of the already-approved fit):
---
${evaluationFramework.slice(0, 2000)}
---`;
    },

    /** Section of the generation prompt dedicated to the email (skill's live email guide). */
    buildEmailSection(targetLang) {
      const { emailStyleGuide } = this.loadReferences();
      if (!emailStyleGuide) return '';
      const langNote =
        targetLang === 'en'
          ? 'Write the email in English (B1–B2/C1 level).'
          : 'Write the email in Portuguese (PT-BR), keeping the same human, direct, recruiter-scannable style.';
      return `
=== EMAIL-WRITER PHILOSOPHY (MANDATORY for emailSubject/emailBody/emailNotes) ===
${langNote}
---
${emailStyleGuide.slice(0, 6500)}
---`;
    },

    templatePath(name) {
      return path.join(templatesDir, name);
    },

    readTemplate(name) {
      return safeRead(path.join(templatesDir, name));
    },
  };
}
