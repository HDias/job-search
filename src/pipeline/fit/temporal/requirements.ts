/** Job-requirement classifier (port of v1 `temporal/requirements.js`). */

import { extractTechSkills } from '../semantic/entities.js';
import { normalizeText } from '../semantic/tokenizer.js';

const DIFFERENTIAL_HEADERS = [
  'will help you succeed',
  'nice to have',
  'bonus',
  'differential',
  'diferencial',
  'desejável',
  'preferred',
  'desirable',
  'good to have',
  'plus',
  'great if',
];

const MUST_HAVE_HEADERS = [
  'qualifications',
  'requirements',
  'requisitos',
  'responsibilities',
  'responsabilidades',
  'what you do',
  'what you ll do',
  'about the role',
  'role overview',
  'you have',
  'you bring',
  'must have',
  'required',
  'atividades',
];

const SKIP_HEADERS = [
  'we also offer',
  'benefits',
  'compensation',
  'perks',
  "let's talk numbers",
  'privacy notice',
  'equal opportunity',
  'eeo',
];

export interface JobRequirements {
  mustHave: string[];
  differentials: string[];
  mustHaveRaw: string;
  differentialRaw: string;
}

export function extractJobRequirements(jobText: unknown): JobRequirements {
  const normalized = normalizeText(jobText);
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let currentSection = 'unknown';
  const mustHaveText: string[] = [];
  const differentialText: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (line.length < 120) {
      if (SKIP_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'skip';
        continue;
      }
      if (DIFFERENTIAL_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'differential';
        continue;
      }
      if (MUST_HAVE_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'musthave';
        continue;
      }
    }

    if (currentSection === 'musthave') {
      mustHaveText.push(line);
    } else if (currentSection === 'differential') {
      differentialText.push(line);
    }
  }

  // No recognizable sections: first half becomes must-have.
  if (mustHaveText.length === 0 && differentialText.length === 0) {
    const mid = Math.floor(lines.length / 2);
    mustHaveText.push(...lines.slice(0, mid));
    differentialText.push(...lines.slice(mid));
  }

  return {
    mustHave: extractTechSkills(mustHaveText.join(' '), 'en'),
    differentials: extractTechSkills(differentialText.join(' '), 'en'),
    mustHaveRaw: mustHaveText.join(' '),
    differentialRaw: differentialText.join(' '),
  };
}

export interface RequirementSections {
  musthave: { lines: string[]; skills: string[] };
  differential: { lines: string[]; skills: string[] };
  skip: { lines: string[]; skills: string[] };
  unknown: { lines: string[]; skills: string[] };
}

export function extractJobRequirementsWithContext(
  jobText: unknown,
): RequirementSections {
  const normalized = normalizeText(jobText);
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sections: RequirementSections = {
    musthave: { lines: [], skills: [] },
    differential: { lines: [], skills: [] },
    skip: { lines: [], skills: [] },
    unknown: { lines: [], skills: [] },
  };

  let currentSection: keyof RequirementSections = 'unknown';

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (line.length < 120) {
      if (SKIP_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'skip';
        continue;
      }
      if (DIFFERENTIAL_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'differential';
        continue;
      }
      if (MUST_HAVE_HEADERS.some((header) => lower.includes(header))) {
        currentSection = 'musthave';
        continue;
      }
    }

    sections[currentSection].lines.push(line);
  }

  for (const section of Object.values(sections)) {
    if (section.lines.length > 0) {
      section.skills = extractTechSkills(section.lines.join(' '), 'en');
    }
  }

  return sections;
}
