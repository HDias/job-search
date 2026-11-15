/**
 * Deterministic question-suggestion engine (port of v1
 * `question_suggestion_engine.mjs` + the markdown view from
 * `generate_question_suggestions.mjs`). No LLM, no filesystem: callers pass
 * the base profile raw text and receive the suggestion object.
 */

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export interface SubPart {
  part: string;
  value: string;
  source: string;
  confidence: SuggestionConfidence;
  notes: string;
  profileReferences?: string[];
}

export interface Suggestion {
  value: unknown;
  source: string;
  confidence: SuggestionConfidence;
  notes: string;
  profileReferences: string[];
  subParts?: SubPart[];
  readyToSend?: string;
  needsAttention?: { part: string; tip: string }[];
}

export interface ApplicationQuestion {
  id?: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
  category?: string;
  [key: string]: unknown;
}

export interface StandardField {
  id: string;
  label?: string;
  type?: string;
  [key: string]: unknown;
}

/** Loose shape accepted by the standard-field mapper (id may be absent). */
export type FieldLike = { id?: string; label?: string; type?: string };

export interface SuggestionInput {
  questions: ApplicationQuestion[];
  standardFields: StandardField[];
  profile: Record<string, unknown> & { rawText?: unknown };
  language?: string;
  profileUsed?: string;
  applicationUrl?: string;
}

export interface SuggestedQuestion extends ApplicationQuestion {
  suggestion: Suggestion;
}

export interface SuggestionsResult {
  metadata: {
    vacancyUrl: string;
    applicationUrl: string;
    generatedAt: string;
    profileUsed: string;
    language: string;
  };
  fieldMappings: Record<string, Suggestion>;
  customQuestions: SuggestedQuestion[];
  legalQuestions: SuggestedQuestion[];
  demographicQuestions: SuggestedQuestion[];
}

/** Strips HTML from a raw resume to plain text. */
export function cleanHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ContactInfo {
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  location?: string;
  [key: string]: unknown;
}

/** Grounded contacts extracted from the base raw text (no invention). */
export function extractContactFromRawText(rawText: unknown): ContactInfo {
  const text = cleanHtml(rawText);
  const out: ContactInfo = {};
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) out.email = email[0];
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phone) out.phone = phone[1].trim().slice(0, 30);
  const linkedin = text.match(/(linkedin\.com\/[^\s)"']+)/i);
  if (linkedin) {
    out.linkedin = `https://www.${linkedin[1].replace(/^www\./i, '')}`;
  }
  const github = text.match(/(github\.com\/[^\s)"']+)/i);
  if (github) out.github = `https://${github[1].replace(/^www\./i, '')}`;
  const location = text.match(
    /[A-ZÀ-Ú][a-zà-ú]+,\s*[A-ZÀ-Ú][a-zà-ú]+,\s*Brazil\b/i,
  );
  if (location) out.location = location[0];
  return out;
}

function extractSummary(text: string): string {
  const match = text.match(/Summary\s*(.*?)(?=Highlights:|Experience\b)/s);
  if (match) return match[1].trim().slice(0, 2000);
  return '';
}

interface ExperienceBlock {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  location: string;
  description: string;
  technologies: string[];
  bullets?: string[];
}

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const EXPERIENCE_DATE_RE = new RegExp(
  `(${MONTHS})\\s*(\\d{4})\\s*[\\-\\u2013\\u2014]\\s*((${MONTHS})\\s*(\\d{4})|Present)`,
  'gi',
);

export function extractExperienceFromRawText(
  rawText: unknown,
): ExperienceBlock[] {
  const text = cleanHtml(rawText);
  const experience: ExperienceBlock[] = [];
  const matches = [...text.matchAll(EXPERIENCE_DATE_RE)];
  let lastIndex = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const blockStart = Math.max(lastIndex, match.index! - 400);
    const blockEnd =
      i + 1 < matches.length
        ? matches[i + 1].index!
        : Math.min(match.index! + 3000, text.length);
    lastIndex = match.index! + match[0].length;
    const block = text.slice(blockStart, blockEnd);
    const beforeDate = text.slice(Math.max(0, match.index! - 300), match.index);

    let company = 'Empresa';
    if (/CESAR/i.test(beforeDate)) company = 'CESAR - Instituto de Inovação';
    else if (/Lecupon|Alloyal/i.test(beforeDate)) company = 'Lecupon/Alloyal';
    else if (/Jedis/i.test(beforeDate)) company = 'Jedis Tecnologia';
    else if (/Caiena/i.test(beforeDate)) company = 'Caiena';
    else if (/Itaú|Itaú Cultural/i.test(beforeDate)) company = 'Escola Itaú Cultural';
    else if (/Palmas School|Public Health Foundation/i.test(beforeDate)) {
      company = 'Palmas School of Public Health Foundation';
    } else if (/SESA|Secretaria Estadual/i.test(beforeDate)) {
      company = 'SESA - Secretaria Estadual de Saúde';
    } else if (/City Hall of Palmas|Prefeitura Municipal de Palmas/i.test(beforeDate)) {
      company = 'City Hall of Palmas - TO';
    } else if (/Sabina Engenharia/i.test(beforeDate)) company = 'Sabina Engenharia Ltda';
    else if (/Consisti/i.test(beforeDate)) company = 'Consisti';
    else if (/Life Sistemas/i.test(beforeDate)) company = 'Life Sistemas';
    else if (/Prefeitura Municipal de Gurupi/i.test(beforeDate)) {
      company = 'Prefeitura Municipal de Gurupi';
    }

    let role = 'Position';
    if (/Senior Software Engineer/i.test(beforeDate)) role = 'Senior Software Engineer';
    else if (/Software Engineer/i.test(beforeDate)) role = 'Software Engineer';
    else if (/Full Stack|Fullstack/i.test(beforeDate)) role = 'Full Stack Developer';
    else if (/Web Developer/i.test(beforeDate)) role = 'Web Developer';
    else if (/Junior Developer/i.test(beforeDate)) role = 'Junior Developer';

    experience.push({
      company,
      role,
      startDate: `${match[1]} ${match[2]}`,
      endDate: match[5] ? `${match[4]} ${match[5]}` : 'Present',
      location: '',
      description: block.slice(0, 1500),
      technologies: [],
    });
  }
  return experience;
}

const TECH_GROUPS: [string, string[]][] = [
  [
    'Backend',
    [
      'Ruby on Rails',
      'Rails',
      'Ruby',
      'PHP',
      'Laravel',
      'Symfony',
      'Zend',
      'Sidekiq',
      'REST',
      'TDD',
      'RSpec',
      'Git',
    ],
  ],
  [
    'Frontend',
    [
      'Vue',
      'Ember',
      'Stimulus',
      'React',
      'Angular',
      'JavaScript',
      'TypeScript',
      'jQuery',
      'HAML',
    ],
  ],
  ['Database', ['PostgreSQL', 'MySQL', 'Redis', 'ElastiCache']],
  ['DevOps/Cloud', ['AWS', 'Docker', 'GitHub Actions', 'GitLab', 'CI/CD', 'Linux']],
  ['Observability', ['Datadog', 'Sentry', 'New Relic', 'AppSignal', 'Splunk']],
  ['AI/Tools', ['Claude Code', 'Cursor', 'GitHub Copilot', 'ChatGPT']],
];

export function extractSkillsFromRawText(
  rawText: unknown,
): Record<string, string[]> {
  const text = cleanHtml(rawText);
  const skills: Record<string, string[]> = {};
  for (const [category, technologies] of TECH_GROUPS) {
    const found: string[] = [];
    for (const technology of technologies) {
      const escaped = technology.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'gi').test(text)) found.push(technology);
    }
    if (found.length > 0) skills[category] = found;
  }
  return skills;
}

function extractEducationFromRawText(rawText: unknown): Record<string, string>[] {
  const text = cleanHtml(rawText);
  const education: Record<string, string>[] = [];
  for (const match of text.matchAll(
    /(Bachelor|Bacharel|Degree|Tecnólogo|Tecnologist|University of|Faculdade)[^.\n]{0,120}/gi,
  )) {
    education.push({ degree: match[0].trim(), institution: '', year: '', field: '' });
  }
  return education.slice(0, 5);
}

function extractCertificationsFromRawText(
  rawText: unknown,
): Record<string, string>[] {
  const text = cleanHtml(rawText);
  const certs: Record<string, string>[] = [];
  for (const match of text.matchAll(
    /(Ruby on Rails|SOLID|Vue JS|TDD|Docker|Ember\.js|AI for Devs|RSpec|Capybara)[^.\n]{0,80}/gi,
  )) {
    certs.push({ name: match[0].trim(), issuer: '', date: '' });
  }
  return certs.slice(0, 10);
}

function extractProjectsFromRawText(rawText: unknown): Record<string, unknown>[] {
  const text = cleanHtml(rawText);
  const projects: Record<string, unknown>[] = [];
  const knownProjects = [
    'e-SUS Vigilância em Saúde',
    'MGM referral system',
    'lottery module',
    'CleverTap integration',
  ];
  for (const name of knownProjects) {
    if (text.includes(name)) projects.push({ name, description: '', technologies: [] });
  }
  return projects;
}

function extractLanguagesFromRawText(rawText: unknown): Record<string, string> {
  const text = cleanHtml(rawText);
  const languages: Record<string, string> = {};
  if (/Português.*Native|Native.*Português/i.test(text)) languages.portuguese = 'Native';
  if (/Inglês.*Professional Working|Professional Working.*Inglês/i.test(text)) {
    languages.english = 'Professional Working';
  }
  return languages;
}

interface ProfileMatch {
  type: 'experience' | 'skills' | 'projects';
  index?: number;
  company?: string;
  role?: string;
  bullet?: string;
  technology?: string;
  category?: string;
  skill?: string;
  proficiency?: unknown;
  name?: string;
  matchedKeywords: string[];
  reference: string;
}

const RELATED_TERMS: Record<string, string[]> = {
  distributed: ['microservices', 'kafka', 'kubernetes', 'event-driven', 'service-oriented'],
  systems: ['architecture', 'platform', 'infrastructure', 'backend', 'microservices'],
  scale: ['high-volume', 'scalable', 'scalability', 'high-availability', 'production', 'millions', 'thousands'],
  microservices: ['distributed', 'kafka', 'kubernetes', 'service-oriented', 'api'],
  kafka: ['distributed', 'event-driven', 'messaging', 'streaming'],
  kubernetes: ['orchestration', 'containers', 'aws', 'eks', 'scalable'],
  aws: ['cloud', 'infrastructure', 'ec2', 'rds', 'scalable', 'production'],
  'high-volume': ['scale', 'scalable', 'production', 'millions', 'high-availability'],
  'real-time': ['georeferenced', 'streaming', 'event-driven'],
  'event-driven': ['kafka', 'distributed', 'messaging', 'async'],
  georeferenced: ['real-time', 'location', 'mapping'],
  monitoring: ['observability', 'datadog', 'newrelic', 'sentry', 'splunk'],
  observability: ['monitoring', 'datadog', 'newrelic', 'sentry', 'splunk'],
};

const STOP_WORDS = new Set([
  'what', 'is', 'your', 'experience', 'with', 'working', 'in', 'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to',
  'have', 'you', 'do', 'did', 'describe', 'explain', 'tell', 'us', 'about', 'how', 'many', 'years', 'level',
  'skill', 'knowledge', 'familiar', 'proficient', 'proficiency', 'rate', 'current', 'currently',
  'worked', 'past', 'reside', 'live', 'based', 'ever', 'interviewed', 'interview', 'authorized', 'work',
  'authorization', 'visa', 'sponsorship', 'citizen', 'consent', 'data', 'processing', 'privacy', 'gdpr', 'lgpd',
  'future', 'position', 'keep', 'considering', 'application', 'recruitment', 'processes', 'open', 'learning',
  'willing', 'learn', 'race', 'ethnic', 'background', 'gender', 'identity', 'sexual', 'orientation',
  'transgender', 'disability', 'chronic', 'condition', 'physical', 'visual', 'auditory', 'cognitive', 'mental',
  'emotional', 'substantially', 'limits', 'major', 'life', 'activities', 'mobility', 'communication', 'seeing',
  'hearing', 'speaking', 'veteran', 'active', 'member', 'armed', 'forces', 'hispanic', 'latino',
]);

function normalizeSuggestion(suggestion: Partial<Suggestion> = {}): Suggestion {
  return {
    value: suggestion.value ?? '',
    source: suggestion.source || 'manual_input_required',
    confidence: suggestion.confidence || 'low',
    notes: suggestion.notes || 'Requires manual review',
    profileReferences: Array.isArray(suggestion.profileReferences)
      ? suggestion.profileReferences
      : [],
    ...(Array.isArray(suggestion.subParts) ? { subParts: suggestion.subParts } : {}),
    ...(typeof suggestion.readyToSend === 'string'
      ? { readyToSend: suggestion.readyToSend }
      : {}),
    ...(Array.isArray(suggestion.needsAttention)
      ? { needsAttention: suggestion.needsAttention }
      : {}),
  };
}

export class QuestionSuggestionEngine {
  readonly profile: Record<string, unknown> & { rawText?: unknown };
  readonly language: string;
  readonly personalInfo: Record<string, unknown>;
  readonly experience: ExperienceBlock[];
  readonly skills: Record<string, string[]>;
  readonly education: Record<string, string>[];
  readonly projects: Record<string, unknown>[];
  readonly certifications: Record<string, string>[];
  private readonly summary: string;
  private readonly languages: Record<string, string>;

  constructor(
    profile: Record<string, unknown> & { rawText?: unknown },
    language = 'en',
  ) {
    this.profile = profile || {};
    this.language = language;
    const rawText = String(profile.rawText ?? '');
    const hasPersonalInfo = Boolean(profile.personalInfo);
    const fallbackInfo = !hasPersonalInfo && rawText
      ? extractContactFromRawText(rawText)
      : {};
    this.personalInfo =
      (profile.personalInfo as Record<string, unknown> | undefined) ??
      fallbackInfo;
    this.experience =
      (profile.experience as ExperienceBlock[] | undefined) ??
      (rawText ? extractExperienceFromRawText(rawText) : []);
    this.skills =
      (profile.skills as Record<string, string[]> | undefined) ??
      (rawText ? extractSkillsFromRawText(rawText) : {});
    this.education =
      (profile.education as Record<string, string>[] | undefined) ??
      (rawText ? extractEducationFromRawText(rawText) : []);
    this.projects =
      (profile.projects as Record<string, unknown>[] | undefined) ??
      (rawText ? extractProjectsFromRawText(rawText) : []);
    this.certifications =
      (profile.certifications as Record<string, string>[] | undefined) ??
      (rawText ? extractCertificationsFromRawText(rawText) : []);
    const cleanText = cleanHtml(rawText);
    this.summary =
      String(
        (profile.personalInfo as { summary?: unknown } | undefined)?.summary ??
          (rawText ? extractSummary(cleanText) : ''),
      ) || '';
    this.languages =
      ((profile.personalInfo as { languages?: Record<string, string> } | undefined)
        ?.languages) ??
      (rawText ? extractLanguagesFromRawText(cleanText) : {});
  }

  generateSuggestions(
    questions: ApplicationQuestion[],
    standardFields: StandardField[],
  ): Omit<SuggestionsResult, 'metadata'> {
    const fieldMappings: Record<string, Suggestion> = {};
    const customQuestions: SuggestedQuestion[] = [];
    const legalQuestions: SuggestedQuestion[] = [];
    const demographicQuestions: SuggestedQuestion[] = [];

    for (const field of standardFields) {
      const suggestion = this.generateStandardFieldSuggestion(field);
      if (suggestion && field.id) {
        fieldMappings[field.id] = normalizeSuggestion(suggestion);
      }
    }

    for (const question of questions) {
      if (question.category === 'demographic') {
        demographicQuestions.push({
          ...question,
          suggestion: normalizeSuggestion({
            value: 'Prefer not to answer',
            source: 'demographic_default',
            confidence: 'high',
            notes:
              'Voluntary EEO question - defaulting to "Prefer not to answer"',
          }),
        });
        continue;
      }

      let suggestion: Partial<Suggestion> | null;
      if (question.category === 'personal' || question.category === 'upload') {
        suggestion = this.generateStandardFieldSuggestion(question);
        if (!suggestion) suggestion = this.generateQuestionSuggestion(question);
      } else {
        suggestion = this.generateQuestionSuggestion(question);
      }

      const categorized: SuggestedQuestion = {
        ...question,
        suggestion: normalizeSuggestion(suggestion),
      };

      switch (question.category) {
        case 'legal':
          legalQuestions.push(categorized);
          break;
        case 'personal':
        case 'upload':
          if (question.id) fieldMappings[question.id] = categorized.suggestion;
          break;
        case 'custom':
          customQuestions.push(categorized);
          break;
        default:
          customQuestions.push(categorized);
      }
    }

    return { fieldMappings, customQuestions, legalQuestions, demographicQuestions };
  }

  generateStandardFieldSuggestion(field: FieldLike): Partial<Suggestion> | null {
    const personal = this.personalInfo;
    const mappings: Record<string, { source: string; value: unknown }> = {
      first_name: { source: 'personalInfo.firstName', value: personal.firstName },
      last_name: { source: 'personalInfo.lastName', value: personal.lastName },
      preferred_name: { source: 'personalInfo.firstName', value: personal.firstName },
      full_name: {
        source: 'personalInfo.firstName + personalInfo.lastName',
        value: `${personal.firstName ?? ''} ${personal.lastName ?? ''}`.trim(),
      },
      email: { source: 'personalInfo.email', value: personal.email },
      phone: { source: 'personalInfo.phone', value: personal.phone },
      country: {
        source: 'personalInfo.location',
        value: String(personal.location ?? '').split(',').pop()?.trim() || '',
      },
      linkedin: { source: 'personalInfo.linkedin', value: personal.linkedin },
      github: { source: 'personalInfo.github', value: personal.github },
      portfolio: { source: 'personalInfo.portfolio', value: personal.portfolio },
      resume: { source: 'generated_file', value: 'curriculo_direcionado.pdf' },
      cover_letter: { source: 'generated_file', value: 'cover_letter.pdf' },
    };

    let mapping = field.id ? mappings[field.id] : undefined;

    if (!mapping && field.label) {
      const label = field.label.toLowerCase();
      if (label.includes('preferred') && label.includes('name')) {
        mapping = { source: 'personalInfo.firstName', value: personal.firstName };
      } else if (label === 'country' || label.includes('country')) {
        mapping = {
          source: 'personalInfo.location',
          value: String(personal.location ?? '').split(',').pop()?.trim() || '',
        };
      } else if (label.includes('linkedin')) {
        mapping = { source: 'personalInfo.linkedin', value: personal.linkedin };
      } else if (label.includes('github')) {
        mapping = { source: 'personalInfo.github', value: personal.github };
      } else if (label.includes('portfolio') || label.includes('website')) {
        mapping = { source: 'personalInfo.portfolio', value: personal.portfolio };
      }
    }

    if (!mapping) return null;

    return {
      value: mapping.value,
      source: mapping.source,
      confidence: mapping.value ? 'high' : 'low',
      notes: 'Direct mapping from profile',
    };
  }

  generateQuestionSuggestion(question: ApplicationQuestion): Partial<Suggestion> {
    const label = question.label || '';
    if (
      (question.type === 'text' || question.type === 'textarea') &&
      this.isCompoundLabel(label)
    ) {
      const compound = this.answerCompound(label);
      if (compound) return compound;
    }
    const type = question.type || 'text';
    const options = question.options || [];

    if ((type === 'select' || type === 'radio') && options.length > 0) {
      return this.matchSelectOptions(label, options);
    }
    if (type === 'checkbox') return this.handleCheckbox(label);
    if (type === 'text' || type === 'textarea') {
      return this.generateTextAnswer(label, question);
    }
    return {
      value: '',
      source: 'unknown',
      confidence: 'low',
      notes: 'Unable to generate suggestion automatically',
    };
  }

  isCompoundLabel(label: string): boolean {
    const text = String(label || '');
    if (text.length < 140) return false;
    const chunks = text.split(/[;,]/).map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length >= 3) return true;
    const andCount = (text.toLowerCase().match(/\band\b|,/g) || []).length;
    return text.length > 220 && andCount >= 3;
  }

  splitCompound(label: string): string[] {
    let text = String(label || '')
      .trim()
      .replace(/^if interested,?\s*(could you please|please)?\s*/i, '')
      .replace(/^(could you please|please)\s+share\s*/i, '');
    text = text.replace(/\s+and\s+(your\s+updated\s+cv\??)\s*$/i, '; $1');
    const parts = text
      .split(/;/)
      .flatMap((part) => part.split(/,(?!\s*\d)/))
      .map((part) => part.trim().replace(/\?+$/, '').trim())
      .filter((part) => part.length > 2)
      .slice(0, 8);
    return parts.length >= 2 ? parts : [];
  }

  extractLocationFromRawText(): string {
    const raw = String(this.profile.rawText ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    const match = raw.match(
      /[A-ZÀ-Ú][a-zà-ú]+,\s*[A-ZÀ-Ú][a-zà-ú]+,\s*Brazil\b|\bBrazil\b|\bBrasil\b/i,
    );
    const location = match
      ? match[0].trim().replace(/\s+/g, ' ').slice(0, 80)
      : '';
    return location || String(this.personalInfo.location ?? '');
  }

  extractYearsFromRawText(): string {
    const match = String(this.profile.rawText ?? '').match(
      /10\+\s*(years?|anos?)/i,
    );
    return match ? match[0].trim() : '';
  }

  rawTextHas(re: RegExp): boolean {
    return re.test(String(this.profile.rawText ?? ''));
  }

  answerCompoundPart(part: string): SubPart {
    const lower = part.toLowerCase();
    if (/time\s*zone|location|where are you|based in|city|country/.test(lower)) {
      const location = this.extractLocationFromRawText();
      return {
        part,
        value: location,
        source: location ? 'profile_rawText_location' : 'manual_input_required',
        confidence: location ? 'medium' : 'low',
        notes: location
          ? `Location found in base ("${location}"). Confirm the timezone with the recruiter (Brazil = UTC-3).`
          : 'Location/timezone not documented; fill manually.',
        profileReferences: location ? ['rawText: location'] : [],
      };
    }
    if (/availability|notice|start date|available to start|when can you/.test(lower)) {
      const value = String(this.personalInfo.noticePeriod ?? '');
      return {
        part,
        value,
        source: value ? 'personalInfo.noticePeriod' : 'manual_input_required',
        confidence: value ? 'high' : 'low',
        notes: value
          ? 'From profile'
          : 'Notice period/availability is not documented; fill manually.',
        profileReferences: [],
      };
    }
    if (/rate|salary|compensation|all-in|usd|expected/.test(lower)) {
      return {
        part,
        value: '',
        source: 'manual_input_required',
        confidence: 'low',
        notes:
          'Rate/salary is NEVER pre-filled (no invented numbers). Fill your monthly all-in USD rate manually.',
        profileReferences: [],
      };
    }
    if (/years.*(ruby|rails)|ruby.*years|total years|how many years|experience.*ruby/.test(lower)) {
      const years = this.extractYearsFromRawText();
      const value = years ? `${years} with Ruby on Rails (production)` : '';
      return {
        part,
        value,
        source: years ? 'profile_rawText_experience' : 'manual_input_required',
        confidence: years ? 'medium' : 'low',
        notes: years
          ? `Base declares "${years}". Confirm it matches the CV headline before sending.`
          : 'Years of experience not found in base; fill manually.',
        profileReferences: years ? ['rawText: 10+ years'] : [],
      };
    }
    if (/interviewing|evaluat|assess.*senior|hiring manager|technical evaluator|entrevist|avalia/.test(lower)) {
      const references: string[] = [];
      if (this.rawTextHas(/mentor/i)) references.push('rawText: Mentored other developers');
      if (this.rawTextHas(/code review/i)) {
        references.push('rawText: code review participation');
      }
      const isPt = this.language === 'pt-br';
      const draft = references.length
        ? isPt
          ? 'Não tenho experiência formal como entrevistador/hiring manager, mas já mentorei outros desenvolvedores e participo de code reviews.'
          : "I don't have formal interviewer/hiring-manager experience, but I've mentored other developers and take part in code reviews."
        : '';
      return {
        part,
        value: draft,
        source: draft ? 'profile_rawText_transferable' : 'manual_input_required',
        confidence: 'low',
        notes: isPt
          ? 'Atenção: sem experiência formal como entrevistador no perfil — NÃO afirme "anos entrevistando". O rascunho acima usa só evidência transferível (mentoria + code review). Ajuste se precisar.'
          : 'Heads-up: no formal interviewer/hiring-manager experience in the base — do NOT claim "years interviewing". The draft above uses transferable evidence only (mentoring + code reviews). Tweak as needed.',
        profileReferences: references,
      };
    }
    if (/technologies|tools|frameworks|libraries/.test(lower)) {
      const allSkills = Object.values(this.skills || {}).flat();
      if (allSkills.length > 0) {
        return {
          part,
          value: `Currently utilizing: ${allSkills.slice(0, 12).join(', ')}.`,
          source: 'skills_summary',
          confidence: 'high',
          notes: `Composed from ${allSkills.length} skills across ${
            Object.keys(this.skills || {}).length
          } categories`,
          profileReferences: Object.entries(this.skills || {}).map(
            ([category, list]) => `skills.${category}: ${list.join(', ')}`,
          ),
        };
      }
    }
    if (/updated cv|your cv|\bcv\b|resume|cover/.test(lower)) {
      return {
        part,
        value: 'curriculo_direcionado.pdf (attach the tailored PDF)',
        source: 'generated_file',
        confidence: 'high',
        notes: 'Attach the generated tailored PDF, not the base resume.',
        profileReferences: [],
      };
    }
    const fallback = this.generateTextAnswer(part, { label: part, type: 'text' });
    return { part, ...fallback } as SubPart;
  }

  answerCompound(label: string): Partial<Suggestion> | null {
    const parts = this.splitCompound(label);
    if (parts.length < 2) return null;
    const subParts = parts.map((part) => this.answerCompoundPart(part));
    const references = [
      ...new Set(subParts.flatMap((sub) => sub.profileReferences || [])),
    ];
    const value = this.buildReadyToSend(subParts);
    const needsAttention = subParts
      .filter((sub) => !sub.value || sub.confidence === 'low')
      .map((sub) => ({ part: sub.part, tip: sub.notes }));
    const filled = subParts.length - needsAttention.length;
    const isPt = this.language === 'pt-br';
    const notes = isPt
      ? `Rascunho pronto para enviar abaixo. ${filled} de ${subParts.length} itens vieram do seu perfil; ${needsAttention.length} precisam de você. Revise os pontos de atenção antes de copiar.`
      : `Ready-to-send draft below. ${filled} of ${subParts.length} items came from your profile; ${needsAttention.length} need your input. Check the attention points before copying.`;
    return {
      value,
      source: 'compound_decomposition',
      confidence: needsAttention.length <= 2 ? 'medium' : 'low',
      notes,
      profileReferences: references,
      subParts,
      readyToSend: value,
      needsAttention,
    };
  }

  buildReadyToSend(subParts: SubPart[]): string {
    const isPt = this.language === 'pt-br';
    const lines = subParts.map((sub) => {
      const part = String(sub.part || '').toLowerCase();
      const value = String(sub.value || '').trim();
      if (/time\s*zone|location|where are you|based in|city|country|localiza/.test(part)) {
        if (value) {
          return isPt
            ? `Localização / fuso: moro em ${value} (UTC-3).`
            : `Location / time zone: I'm based in ${value} (UTC-3).`;
        }
        return isPt
          ? 'Localização / fuso: [preencher cidade + UTC-3].'
          : 'Location / time zone: [fill in city + time zone].';
      }
      if (/availability|notice|start date|available to start|when can you|disponibilidade|aviso/.test(part)) {
        if (value) {
          return isPt ? `Disponibilidade: ${value}.` : `Availability / notice period: ${value}.`;
        }
        return isPt
          ? 'Disponibilidade: [preencher — ex.: imediata / aviso de X semanas].'
          : "Availability / notice period: [fill in — e.g. available immediately / X weeks' notice].";
      }
      if (/rate|salary|compensation|all-in|usd|expected|valor|salário|pretensão/.test(part)) {
        return isPt
          ? 'Valor mensal all-in (USD): [preencher seu valor].'
          : 'Expected monthly all-in rate (USD): [fill in your rate].';
      }
      if (/years.*(ruby|rails)|ruby.*years|total years|how many years|experience.*ruby|anos.*ruby|ruby.*anos/.test(part)) {
        if (value) {
          return isPt ? `Experiência com Ruby/Rails: ${value}.` : `Ruby/Rails experience: ${value}.`;
        }
        return isPt ? 'Experiência com Ruby/Rails: [preencher].' : 'Ruby/Rails experience: [fill in].';
      }
      if (/interviewing|evaluat|assess.*senior|hiring manager|technical evaluator|entrevist|avalia/.test(part)) {
        if (value) {
          return isPt
            ? `Entrevistas/avaliação de seniores: ${value}`
            : `Interviewing / evaluating senior engineers: ${value}`;
        }
        return isPt
          ? 'Entrevistas/avaliação de seniores: [preencher — não afirme experiência formal se não houver].'
          : "Interviewing / evaluating senior engineers: [fill in — don't claim formal experience if you don't have it].";
      }
      if (/updated cv|your cv|\bcv\b|resume|currículo/.test(part)) {
        return isPt
          ? 'CV atualizado: anexado (PDF direcionado).'
          : 'Updated CV: attached (tailored PDF).';
      }
      return `- ${sub.part}: ${value || (isPt ? '[preencher]' : '[fill in]')}`;
    });
    const greeting = isPt
      ? 'Oi! Obrigado pelo contato — tenho interesse na vaga.'
      : "Hi! Thanks for reaching out — I'm interested in the role.";
    const closing = isPt
      ? 'Fico à disposição para o próximo passo!'
      : 'Happy to move to the next step — just let me know!';
    return `${greeting}\n\n${lines.join('\n')}\n\n${closing}`;
  }

  matchSelectOptions(label: string, options: string[]): Partial<Suggestion> {
    const lower = label.toLowerCase();

    if (
      options.some((option) => /^yes$/i.test(option)) &&
      options.some((option) => /^no$/i.test(option))
    ) {
      if (
        lower.includes('authorized to work') ||
        lower.includes('work authorization') ||
        lower.includes('visa') ||
        lower.includes('sponsorship')
      ) {
        const hasAuth = this.checkWorkAuthorization(lower);
        if (hasAuth === null) {
          return {
            value: '',
            source: 'manual_input_required',
            confidence: 'low',
            notes:
              'Work authorization is not explicitly documented. Manual confirmation is required; misrepresentation can have legal consequences.',
          };
        }
        return {
          value: hasAuth ? 'Yes' : 'No',
          source:
            'personalInfo.citizenship + personalInfo.workAuthorization + personalInfo.location',
          confidence: 'high',
          notes: hasAuth
            ? 'Profile indicates work authorization for this location'
            : 'Profile indicates no work authorization; answer truthfully',
        };
      }

      if (lower.includes('worked for') || lower.includes('employed by')) {
        const company = this.extractCompanyFromQuestion(label);
        const hasWorked = this.checkPreviousEmployment(company);
        return {
          value: hasWorked ? 'Yes' : '',
          source: hasWorked ? 'experience_analysis' : 'manual_input_required',
          confidence: hasWorked ? 'high' : 'low',
          notes: hasWorked
            ? `Found ${company} in employment history`
            : `The supplied profile does not prove whether the candidate previously worked for ${company}; manual confirmation is required`,
        };
      }

      if (lower.includes('interviewed') || lower.includes('interview')) {
        const company = this.extractCompanyFromQuestion(label);
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes: `Interview history with ${company} is not documented; manual confirmation is required`,
        };
      }

      if (lower.includes('reside') || lower.includes('live in') || lower.includes('currently in')) {
        const country = this.extractCountryFromQuestion(label);
        const resides = this.checkResidence(country);
        if (resides === null) {
          return {
            value: '',
            source: 'manual_input_required',
            confidence: 'low',
            notes: 'Residence cannot be determined from the supplied profile.',
          };
        }
        return {
          value: resides ? 'Yes' : 'No',
          source: 'personalInfo.location',
          confidence: 'high',
          notes: resides
            ? `Profile indicates residence in ${country}`
            : `Profile does not indicate residence in ${country}`,
        };
      }

      if (
        lower.includes('consent') ||
        lower.includes('data processing') ||
        lower.includes('privacy') ||
        lower.includes('gdpr') ||
        lower.includes('lgpd')
      ) {
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes: 'Consent is a user decision. Review the terms and answer manually.',
        };
      }

      if (lower.includes('future') || lower.includes('other position') || lower.includes('keep')) {
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes: 'Optional candidate preference; answer manually.',
        };
      }

      if (
        lower.includes('open to learning') ||
        lower.includes('willing to learn') ||
        lower.includes('work with')
      ) {
        const technology = this.extractTechnologyFromQuestion(label);
        return {
          value: 'Yes',
          source: 'skills_adaptability',
          confidence: 'medium',
          notes: `Profile shows adaptability with multiple technologies (${Object.keys(
            this.skills,
          ).join(', ')}); open to learning ${technology}`,
        };
      }

      return {
        value: 'Select...',
        source: 'manual_review_required',
        confidence: 'low',
        notes: 'Requires human review - context dependent',
      };
    }

    if (lower.includes('english') || lower.includes('language') || lower.includes('proficiency')) {
      const englishLevel =
        (this.personalInfo.languages as Record<string, string> | undefined)?.english ||
        (this.personalInfo.languages as Record<string, string> | undefined)?.ingles;
      if (!englishLevel) {
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes: 'English proficiency is not explicitly documented.',
        };
      }
      return {
        value: this.normalizeEnglishLevel(englishLevel, options),
        source: 'personalInfo.languages.english',
        confidence: 'high',
        notes: `Profile declares: ${englishLevel}`,
      };
    }

    if (lower.includes('country') || (lower.includes('location') && !lower.includes('reside'))) {
      const country = String(this.personalInfo.location ?? '').split(',').pop()?.trim();
      if (!country) {
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes: 'Country/location is not explicitly documented.',
        };
      }
      const matched = options.find((option) =>
        option.toLowerCase().includes(country.toLowerCase()),
      );
      return {
        value: matched || '',
        source: 'personalInfo.location',
        confidence: matched ? 'high' : 'low',
        notes: matched
          ? 'Direct match from profile location'
          : 'No exact option matches the documented location; review manually.',
      };
    }

    return {
      value: '',
      source: 'manual_input_required',
      confidence: 'low',
      notes: 'No grounded option match; requires manual review',
    };
  }

  handleCheckbox(label: string): Partial<Suggestion> {
    const lower = label.toLowerCase();

    if (
      lower.includes('consent') ||
      lower.includes('data processing') ||
      lower.includes('privacy') ||
      lower.includes('terms')
    ) {
      return {
        value: false,
        source: 'manual_input_required',
        confidence: 'low',
        notes: 'Consent is a user decision. Review the terms and check manually if accepted.',
      };
    }

    if (
      lower.includes('open to learning') ||
      lower.includes('willing to learn') ||
      lower.includes('work with')
    ) {
      const technology = this.extractTechnologyFromQuestion(label);
      return {
        value: true,
        source: 'skills_adaptability',
        confidence: 'medium',
        notes: `Profile shows experience with multiple technologies; open to ${technology}`,
      };
    }

    if (lower.includes('confirm') || lower.includes('acknowledge') || lower.includes('agree')) {
      return {
        value: false,
        source: 'manual_input_required',
        confidence: 'low',
        notes: 'Acknowledgement or agreement requires explicit user review.',
      };
    }

    return {
      value: false,
      source: 'unknown',
      confidence: 'low',
      notes: 'Requires human review',
    };
  }

  generateTextAnswer(
    label: string,
    _question: Pick<ApplicationQuestion, 'label' | 'type'>,
  ): Partial<Suggestion> {
    const lower = label.toLowerCase();

    if (lower.includes('linkedin') && (lower.includes('profile') || lower.includes('url') || lower.includes('link'))) {
      return {
        value: this.personalInfo.linkedin || '',
        source: 'personalInfo.linkedin',
        confidence: this.personalInfo.linkedin ? 'high' : 'low',
        notes: this.personalInfo.linkedin
          ? 'Direct mapping from profile'
          : 'Not documented; manual input required',
      };
    }

    if (lower.includes('github') || lower.includes('portfolio') || lower.includes('website')) {
      return {
        value: this.personalInfo.github || this.personalInfo.portfolio || '',
        source: 'personalInfo.github/portfolio',
        confidence:
          this.personalInfo.github || this.personalInfo.portfolio ? 'high' : 'low',
        notes:
          this.personalInfo.github || this.personalInfo.portfolio
            ? 'Direct mapping from profile'
            : 'Not documented; manual input required',
      };
    }

    if (lower.includes('reside') || lower.includes('live in') || lower.includes('currently in') || lower.includes('based in')) {
      const country = this.extractCountryFromQuestion(label);
      if (country) {
        const resides = this.checkResidence(country);
        if (resides === null) {
          return {
            value: '',
            source: 'manual_input_required',
            confidence: 'low',
            notes: 'Residence is not explicitly documented.',
          };
        }
        return {
          value: resides
            ? `Yes, I currently reside in ${country}.`
            : `No, I do not currently reside in ${country}.`,
          source: 'personalInfo.location',
          confidence: 'high',
          notes: resides
            ? `Profile indicates residence in ${country}`
            : `Profile does not indicate residence in ${country}`,
        };
      }
      return {
        value: this.personalInfo.location
          ? `I currently reside in ${this.personalInfo.location}.`
          : '',
        source: this.personalInfo.location
          ? 'personalInfo.location'
          : 'manual_input_required',
        confidence: this.personalInfo.location ? 'high' : 'low',
        notes: this.personalInfo.location
          ? `Based on profile location: ${this.personalInfo.location}`
          : 'Location is not documented; manual input required',
      };
    }

    const asksTechnologies =
      lower.includes('technologies') ||
      lower.includes('tools') ||
      lower.includes('frameworks') ||
      lower.includes('libraries') ||
      lower.includes('programming languages');
    const asksUsage =
      lower.includes('currently') ||
      lower.includes('utilizing') ||
      lower.includes('using') ||
      lower.includes('work with') ||
      lower.includes('experience with') ||
      lower.includes('significant experience');
    if (asksTechnologies && asksUsage) {
      const allSkills = Object.values(this.skills || {}).flat();
      if (allSkills.length > 0) {
        return {
          value: `Currently utilizing: ${allSkills.slice(0, 12).join(', ')}.`,
          source: 'skills_summary',
          confidence: 'high',
          notes: `Composed from ${allSkills.length} skills across ${
            Object.keys(this.skills || {}).length
          } categories`,
          profileReferences: Object.entries(this.skills || {}).map(
            ([category, list]) => `skills.${category}: ${list.join(', ')}`,
          ),
        };
      }
    }

    if (lower.includes('english') || lower.includes('language') || lower.includes('proficiency')) {
      const englishLevel =
        (this.personalInfo.languages as Record<string, string> | undefined)?.english ||
        (this.personalInfo.languages as Record<string, string> | undefined)?.ingles ||
        this.languages.english ||
        this.languages.ingles;
      return {
        value: englishLevel || '',
        source: englishLevel ? 'personalInfo.languages.english' : 'manual_input_required',
        confidence: englishLevel ? 'high' : 'low',
        notes: englishLevel
          ? `Profile declares: ${englishLevel}.`
          : 'English proficiency is not explicitly documented.',
      };
    }

    if (
      lower.includes('authorized to work') ||
      lower.includes('work authorization') ||
      lower.includes('visa') ||
      lower.includes('sponsorship')
    ) {
      const hasAuth = this.checkWorkAuthorization(lower);
      if (hasAuth === null) {
        return {
          value: '',
          source: 'manual_input_required',
          confidence: 'low',
          notes:
            'Work authorization is not explicitly documented. Manual confirmation is required; misrepresentation can have legal consequences.',
        };
      }
      return {
        value: hasAuth ? 'Yes' : 'No',
        source:
          'personalInfo.citizenship + personalInfo.workAuthorization + personalInfo.location',
        confidence: 'high',
        notes: hasAuth
          ? 'Profile indicates work authorization for this location'
          : 'Profile indicates no work authorization; answer truthfully. CRITICAL: Misrepresentation can have legal consequences.',
      };
    }

    if (lower.includes('worked for') || lower.includes('employed by')) {
      const company = this.extractCompanyFromQuestion(label);
      const hasWorked = this.checkPreviousEmployment(company);
      return {
        value: hasWorked ? 'Yes' : '',
        source: hasWorked ? 'experience_analysis' : 'manual_input_required',
        confidence: hasWorked ? 'high' : 'low',
        notes: hasWorked
          ? `Found ${company} in employment history`
          : `Previous employment at ${company} is not established by the supplied profile; manual confirmation is required`,
      };
    }

    if (lower.includes('interviewed') || lower.includes('interview')) {
      const company = this.extractCompanyFromQuestion(label);
      return {
        value: '',
        source: 'manual_input_required',
        confidence: 'low',
        notes: `Interview history with ${company} is not documented; manual confirmation is required`,
      };
    }

    if (
      lower.includes('consent') ||
      lower.includes('data processing') ||
      lower.includes('privacy') ||
      lower.includes('gdpr') ||
      lower.includes('lgpd')
    ) {
      return {
        value: '',
        source: 'manual_input_required',
        confidence: 'low',
        notes: 'Consent is a user decision. Review the terms and answer manually.',
      };
    }

    if (
      lower.includes('future') ||
      lower.includes('other position') ||
      lower.includes('keep') ||
      lower.includes('considering my application for future')
    ) {
      return {
        value: '',
        source: 'manual_input_required',
        confidence: 'low',
        notes: 'Optional candidate preference; answer manually.',
      };
    }

    if (
      lower.includes('open to learning') ||
      lower.includes('willing to learn') ||
      lower.includes('work with')
    ) {
      const technology = this.extractTechnologyFromQuestion(label);
      return {
        value: `Yes, I am open to learning and working with ${technology}.`,
        source: 'skills_adaptability',
        confidence: 'medium',
        notes: `Profile shows adaptability with multiple technologies (${Object.keys(
          this.skills,
        ).join(', ')}); open to learning ${technology}`,
      };
    }

    const keywords = this.extractKeywords(label);
    const matches = this.searchProfile(keywords);

    if (matches.length > 0) {
      return {
        value: this.composeExperienceAnswer(label, matches),
        source: 'experience + skills synthesis',
        confidence:
          matches.length >= 3 ? 'high' : matches.length >= 2 ? 'medium' : 'low',
        notes: `Composed from ${matches.length} profile sections`,
        profileReferences: matches.map((match) => match.reference),
      };
    }

    if (lower.includes('salary') || lower.includes('compensation') || lower.includes('expectation')) {
      const salary = this.personalInfo.salaryExpectation;
      return {
        value: salary || '',
        source: salary ? 'personalInfo.salaryExpectation' : 'manual_input_required',
        confidence: salary ? 'high' : 'low',
        notes: salary
          ? 'From profile'
          : 'Salary expectation is not documented; manual input required',
      };
    }

    if (lower.includes('notice') || lower.includes('availability') || lower.includes('start date')) {
      const notice = this.personalInfo.noticePeriod;
      return {
        value: notice || '',
        source: notice ? 'personalInfo.noticePeriod' : 'manual_input_required',
        confidence: notice ? 'high' : 'low',
        notes: notice
          ? 'From profile'
          : 'Notice period is not documented; manual input required',
      };
    }

    if (lower.includes('years of experience') || lower.includes('how many years')) {
      const totalYears = this.calculateTotalExperience();
      return {
        value: `${totalYears}+ years`,
        source: 'experience_calculation',
        confidence: 'high',
        notes: `Calculated from ${this.experience.length} roles since ${this.getEarliestExperienceYear()}`,
      };
    }

    if (
      lower.includes('why') &&
      (lower.includes('company') ||
        lower.includes('role') ||
        lower.includes('position') ||
        lower.includes('interested'))
    ) {
      return {
        value: '',
        source: 'requires_personal_motivation',
        confidence: 'low',
        notes:
          'Requires personal motivation - cannot be generated from profile facts alone',
      };
    }

    return {
      value: '',
      source: 'manual_input_required',
      confidence: 'low',
      notes:
        'Open-ended question requires personalized response based on your experience',
    };
  }

  extractKeywords(label: string): string[] {
    return label
      .toLowerCase()
      .replace(/[?*.,]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  }

  searchProfile(keywords: string[]): ProfileMatch[] {
    const matches: ProfileMatch[] = [];
    const expanded = this.expandKeywords(keywords);

    for (let i = 0; i < this.experience.length; i++) {
      const experience = this.experience[i];
      for (const bullet of experience.bullets || []) {
        const lower = bullet.toLowerCase();
        const matchedKeywords = expanded.filter((keyword) =>
          lower.includes(keyword.toLowerCase()),
        );
        if (matchedKeywords.length > 0) {
          matches.push({
            type: 'experience',
            index: i,
            company: experience.company,
            role: experience.role,
            bullet,
            matchedKeywords,
            reference: `experience[${i}].bullets: ${matchedKeywords.join(', ')}`,
          });
        }
      }
      for (const technology of experience.technologies || []) {
        const matchedKeywords = expanded.filter(
          (keyword) =>
            technology.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(technology.toLowerCase()),
        );
        if (matchedKeywords.length > 0) {
          matches.push({
            type: 'experience',
            index: i,
            company: experience.company,
            role: experience.role,
            technology,
            matchedKeywords,
            reference: `experience[${i}].technologies: ${technology}`,
          });
        }
      }
    }

    for (const [category, skillList] of Object.entries(this.skills)) {
      if (Array.isArray(skillList)) {
        for (const skill of skillList) {
          const matchedKeywords = expanded.filter(
            (keyword) =>
              skill.toLowerCase().includes(keyword.toLowerCase()) ||
              keyword.toLowerCase().includes(skill.toLowerCase()),
          );
          if (matchedKeywords.length > 0) {
            matches.push({
              type: 'skills',
              category,
              skill,
              matchedKeywords,
              reference: `skills.${category}: ${skill}`,
            });
          }
        }
      } else if (
        typeof (skillList as unknown) === 'number' ||
        typeof (skillList as unknown) === 'string'
      ) {
        const proficiency = skillList as unknown as string | number;
        const matchedKeywords = expanded.filter(
          (keyword) =>
            category.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(category.toLowerCase()),
        );
        if (matchedKeywords.length > 0) {
          matches.push({
            type: 'skills',
            category,
            proficiency,
            matchedKeywords,
            reference: `skills.${category}: ${proficiency}/5`,
          });
        }
      }
    }

    for (let i = 0; i < this.projects.length; i++) {
      const project = this.projects[i];
      const text = `${project.name} ${project.description} ${(
        (project.technologies as string[]) || []
      ).join(' ')}`.toLowerCase();
      const matchedKeywords = expanded.filter((keyword) =>
        text.includes(keyword.toLowerCase()),
      );
      if (matchedKeywords.length > 0) {
        matches.push({
          type: 'projects',
          index: i,
          name: String(project.name),
          matchedKeywords,
          reference: `projects[${i}]: ${project.name} - ${matchedKeywords.join(', ')}`,
        });
      }
    }

    return matches;
  }

  expandKeywords(keywords: string[]): string[] {
    const expanded = new Set(keywords);
    for (const keyword of keywords) {
      for (const term of RELATED_TERMS[keyword] ?? []) expanded.add(term);
    }
    return Array.from(expanded);
  }

  composeExperienceAnswer(_label: string, matches: ProfileMatch[]): string {
    const expMatches = matches.filter((match) => match.type === 'experience');
    const skillMatches = matches.filter((match) => match.type === 'skills');
    const projMatches = matches.filter((match) => match.type === 'projects');

    let answer = '';

    if (expMatches.length > 0) {
      const uniqueBullets = [
        ...new Set(expMatches.map((match) => match.bullet).filter(Boolean)),
      ];
      if (uniqueBullets.length > 0) {
        answer += `${uniqueBullets.slice(0, 3).join(' ')} `;
      }
    }

    if (skillMatches.length > 0) {
      const skills = [
        ...new Set(skillMatches.map((match) => match.skill || match.category).filter(Boolean)),
      ];
      if (skills.length > 0) answer += `Proficient in ${skills.slice(0, 5).join(', ')}. `;
    }

    if (projMatches.length > 0) {
      const projects = [...new Set(projMatches.map((match) => match.name).filter(Boolean))];
      if (projects.length > 0) answer += `Key projects: ${projects.slice(0, 2).join(', ')}. `;
    }

    if (!answer) {
      const keywords = matches.map((match) => match.matchedKeywords).flat();
      answer = `Based on my background in ${[...new Set(keywords)]
        .slice(0, 3)
        .join(', ')}, I have relevant experience to contribute to this area.`;
    }

    if (answer.trim() === 'Proficient in distributedSystems.') {
      const distributed = matches.filter((match) =>
        match.matchedKeywords.some(
          (keyword) =>
            keyword.toLowerCase().includes('distributed') ||
            keyword.toLowerCase().includes('scale'),
        ),
      );
      const bullets = distributed
        .filter((match) => match.type === 'experience' && match.bullet)
        .map((match) => match.bullet)
        .slice(0, 2);
      if (bullets.length > 0) answer = `${bullets.join(' ')} `;
    }

    return answer.trim();
  }

  checkWorkAuthorization(labelLower: string): boolean | null {
    const citizenshipRaw = this.personalInfo.citizenship;
    const citizenship = Array.isArray(citizenshipRaw)
      ? citizenshipRaw
      : citizenshipRaw
        ? [citizenshipRaw]
        : [];
    const workAuth = String(this.personalInfo.workAuthorization ?? '');
    const location = String(this.personalInfo.location ?? '');

    if (citizenship.length === 0 && !workAuth && !location) return null;

    if (
      labelLower.includes('usa') ||
      labelLower.includes('united states') ||
      labelLower.includes('america')
    ) {
      if (
        citizenship.some((entry) => /american|united states|\bus\b/i.test(String(entry))) ||
        /united states|\bus\b/i.test(workAuth)
      ) {
        return true;
      }
      if (/no|not authorized|requires sponsorship/i.test(workAuth)) return false;
      return null;
    }

    if (labelLower.includes('brazil') || labelLower.includes('brasil')) {
      if (
        citizenship.some((entry) => /brazilian|brasileir/i.test(String(entry))) ||
        /brazil|brasil/i.test(location) ||
        /brazil|brasil/i.test(workAuth)
      ) {
        return true;
      }
      if (/no|not authorized/i.test(workAuth)) return false;
      return null;
    }

    return null;
  }

  checkPreviousEmployment(company: string): boolean {
    if (!company) return false;
    return this.experience.some(
      (experience) =>
        experience.company.toLowerCase().includes(company.toLowerCase()) ||
        company.toLowerCase().includes(experience.company.toLowerCase()),
    );
  }

  extractCompanyFromQuestion(label: string): string {
    const patterns = [
      /worked for\s+([^?]+)/i,
      /employed by\s+([^?]+)/i,
      /interviewed with\s+([^?]+)/i,
      /interview with\s+([^?]+)/i,
    ];
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
  }

  checkResidence(country: string): boolean | null {
    if (!country) return null;
    const location = String(this.personalInfo.location ?? '');
    if (!location) return null;
    return location.toLowerCase().includes(country.toLowerCase());
  }

  extractCountryFromQuestion(label: string): string {
    const patterns = [
      /reside in\s+([^?]+)/i,
      /live in\s+([^?]+)/i,
      /currently in\s+([^?]+)/i,
      /based in\s+([^?]+)/i,
    ];
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
  }

  extractTechnologyFromQuestion(label: string): string {
    const patterns = [
      /open to learning.*?(\w+)/i,
      /willing to learn.*?(\w+)/i,
      /work with\s+(\w+)/i,
      /working with\s+(\w+)/i,
    ];
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) return match[1].trim();
    }
    return 'new technologies';
  }

  normalizeEnglishLevel(profileLevel: string, options: string[]): string {
    const levelMap: Record<string, string[]> = {
      native: ['Native', 'Mother tongue'],
      fluent: ['Fluent', 'Full professional proficiency'],
      'professional working': [
        'Professional Working',
        'Professional working proficiency',
        'Professional',
      ],
      'limited working': ['Limited Working', 'Limited working proficiency', 'Basic'],
      elementary: ['Elementary', 'Basic', 'Beginner'],
    };
    const lower = profileLevel.toLowerCase();
    for (const [key, variations] of Object.entries(levelMap)) {
      if (lower.includes(key)) {
        const match = options.find((option) =>
          variations.some((variation) =>
            option.toLowerCase().includes(variation.toLowerCase()),
          ),
        );
        if (match) return match;
      }
    }
    const direct = options.find(
      (option) =>
        option.toLowerCase().includes(lower) || lower.includes(option.toLowerCase()),
    );
    return direct || options[0] || profileLevel;
  }

  calculateTotalExperience(): number {
    let totalMonths = 0;
    const now = new Date();
    for (const experience of this.experience) {
      const start = parseDate(experience.startDate);
      const end =
        experience.endDate && experience.endDate.toLowerCase() !== 'present'
          ? parseDate(experience.endDate)
          : now;
      if (start && end) {
        totalMonths +=
          (end.getFullYear() - start.getFullYear()) * 12 +
          (end.getMonth() - start.getMonth());
      }
    }
    return Math.round(totalMonths / 12);
  }

  getEarliestExperienceYear(): number {
    let earliest = new Date().getFullYear();
    for (const experience of this.experience) {
      const year = parseInt(String(experience.startDate ?? '').split('-')[0], 10) || earliest;
      if (year < earliest) earliest = year;
    }
    return earliest;
  }
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parts[1] ? parseInt(parts[1], 10) - 1 : 0;
  return Number.isNaN(year) ? null : new Date(year, month);
}

/** Runs the engine and wraps the result with metadata. */
export function generateSuggestions(input: SuggestionInput): SuggestionsResult {
  const language = input.language === 'pt-br' ? 'pt-br' : 'en';
  const engine = new QuestionSuggestionEngine(input.profile, language);
  const suggestions = engine.generateSuggestions(
    input.questions,
    input.standardFields,
  );
  return {
    metadata: {
      vacancyUrl: input.applicationUrl || '',
      applicationUrl: input.applicationUrl || '',
      generatedAt: new Date().toISOString(),
      profileUsed: input.profileUsed || 'base_profile',
      language,
    },
    ...suggestions,
  };
}

/* ------------------------------ markdown ------------------------------- */

function escapeMd(text: unknown): string {
  if (!text) return '';
  return String(text)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
    .trim();
}

function formatFieldLabel(fieldId: string, isPt: boolean): string {
  const labels: Record<string, string> = {
    first_name: isPt ? 'Primeiro Nome' : 'First Name',
    last_name: isPt ? 'Sobrenome' : 'Last Name',
    preferred_name: isPt ? 'Nome Preferido' : 'Preferred Name',
    full_name: isPt ? 'Nome Completo' : 'Full Name',
    email: 'Email',
    phone: isPt ? 'Telefone' : 'Phone',
    country: isPt ? 'País' : 'Country',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    portfolio: isPt ? 'Portfólio' : 'Portfolio',
    resume: isPt ? 'Currículo (PDF)' : 'Resume (PDF)',
    cover_letter: isPt ? 'Carta de Apresentação (PDF)' : 'Cover Letter (PDF)',
  };
  return labels[fieldId] || fieldId;
}

function extractRoleFromUrl(url: unknown): string {
  try {
    const parsed = new URL(String(url));
    const token = parsed.searchParams.get('token');
    if (token) return `Job ID: ${token}`;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/** Human-readable view of the suggestions (`sugestoes_respostas.md`). */
export function renderSuggestionsMarkdown(
  result: SuggestionsResult,
  questionsData: {
    applicationUrl?: string;
    questions?: ApplicationQuestion[];
    standardFields?: StandardField[];
  },
  language = 'en',
): string {
  const isPt = language === 'pt-br';
  const labels = {
    title: isPt
      ? 'Sugestões de Respostas - Formulário de Candidatura'
      : 'Application Form Answer Suggestions',
    vacancy: isPt ? 'Vaga' : 'Position',
    date: isPt ? 'Data' : 'Date',
    source: isPt ? 'Fonte' : 'Source',
    profileUsed: isPt ? 'Perfil Base' : 'Base Profile',
    warning: isPt ? 'IMPORTANTE - LEIA ANTES DE USAR' : 'IMPORTANT - READ BEFORE USE',
    warningText: isPt
      ? 'Estas são SUGESTÕES baseadas no seu perfil base. NÃO envie sem revisar.'
      : 'These are SUGGESTIONS based on your base profile. DO NOT submit without reviewing.',
    standardFields: isPt
      ? 'Campos Padrão (Preenchimento Automático)'
      : 'Standard Fields (Auto-fill)',
    field: isPt ? 'Campo' : 'Field',
    suggestion: isPt ? 'Sugestão' : 'Suggestion',
    sourceLabel: isPt ? 'Fonte no Perfil' : 'Profile Source',
    customQuestions: isPt
      ? 'Perguntas Específicas da Empresa'
      : 'Company-Specific Questions',
    type: isPt ? 'Tipo' : 'Type',
    required: isPt ? 'Obrigatório' : 'Required',
    options: isPt ? 'Opções' : 'Options',
    justification: isPt ? 'Justificativa' : 'Justification',
    profileSource: isPt ? 'Fonte no Perfil' : 'Profile Source',
    legalQuestions: isPt
      ? 'Perguntas Legais / Conformidade'
      : 'Legal / Compliance Questions',
    demographicQuestions: isPt
      ? 'Perguntas Demográficas (Opcionais - EEO)'
      : 'Demographic Questions (Optional - EEO)',
    question: isPt ? 'Pergunta' : 'Question',
    checklist: isPt ? 'Checklist de Revisão' : 'Review Checklist',
  };

  const questionLabels: Record<string, string> = {};
  for (const question of questionsData.questions || []) {
    if (question.id && question.label) questionLabels[question.id] = question.label;
  }
  for (const field of questionsData.standardFields || []) {
    if (field.id && field.label) questionLabels[field.id] = field.label;
  }

  let markdown = `# ${labels.title}\n\n`;
  markdown += `**${labels.vacancy}:** ${extractRoleFromUrl(questionsData.applicationUrl)}  \n`;
  markdown += `**${labels.date}:** ${new Date().toLocaleDateString(
    isPt ? 'pt-BR' : 'en-US',
  )}  \n`;
  markdown += `**${labels.source}:** ${questionsData.applicationUrl ?? ''}  \n`;
  markdown += `**${labels.profileUsed}:** ${result.metadata.profileUsed}  \n\n`;
  markdown += '---\n\n';
  markdown += `## ⚠️ ${labels.warning}\n\n> ${labels.warningText}\n\n---\n\n`;

  markdown += `## ${labels.standardFields}\n\n`;
  markdown += `| ${labels.field} | ${labels.suggestion} | ${labels.sourceLabel} |\n`;
  markdown += '|---|---|---|\n';
  for (const [fieldId, mapping] of Object.entries(result.fieldMappings)) {
    const label = questionLabels[fieldId] || formatFieldLabel(fieldId, isPt);
    const value = mapping.value || (isPt ? '(não preenchido)' : '(not filled)');
    markdown += `| ${escapeMd(label)} | ${escapeMd(value)} | ${mapping.source} |\n`;
  }
  markdown += '\n---\n\n';

  const renderQuestions = (items: SuggestedQuestion[], title: string): void => {
    if (items.length === 0) return;
    markdown += `## ${title}\n\n`;
    items.forEach((item, index) => {
      markdown += `### ${index + 1}. ${escapeMd(item.label)}\n`;
      markdown += `**${labels.type}:** ${item.type ?? 'text'}  \n`;
      if (item.options && item.options.length > 0) {
        markdown += `**${labels.options}:** ${item.options.join(', ')}  \n`;
      }
      markdown += `**${labels.required}:** ${
        item.required ? (isPt ? 'Sim' : 'Yes') : isPt ? 'Não' : 'No'
      }  \n`;
      const suggestion = item.suggestion;
      const isCompound =
        Array.isArray(suggestion.subParts) && suggestion.subParts.length > 0;
      const draft = suggestion.readyToSend || suggestion.value || '';
      if (isCompound) {
        markdown += `**${
          isPt
            ? '✉️ Pronto para enviar (copie e ajuste os colchetes)'
            : '✉️ Ready to send (copy and fill the brackets)'
        }:**\n\`\`\`\n${escapeMd(draft)}\n\`\`\`\n`;
      } else {
        markdown += `**${labels.suggestion}:** ${escapeMd(suggestion.value)}  \n`;
      }
      markdown += `**${labels.justification}:** ${escapeMd(suggestion.notes)}  \n`;
      if (suggestion.profileReferences.length > 0) {
        markdown += `**${labels.profileSource}:**\n`;
        for (const reference of suggestion.profileReferences) {
          markdown += `- ${escapeMd(reference)}\n`;
        }
      }
      markdown += '\n---\n\n';
    });
  };

  renderQuestions(result.customQuestions, labels.customQuestions);
  renderQuestions(result.legalQuestions, labels.legalQuestions);

  if (result.demographicQuestions.length > 0) {
    markdown += `## ${labels.demographicQuestions}\n\n`;
    markdown += `| ${labels.question} | ${labels.suggestion} |\n|---|---|\n`;
    for (const item of result.demographicQuestions) {
      markdown += `| ${escapeMd(item.label)} | ${escapeMd(
        item.suggestion.value,
      )} |\n`;
    }
    markdown += '\n---\n\n';
  }

  markdown += `## ${labels.checklist}\n\n`;
  const checklist = isPt
    ? [
        'Todos os dados pessoais conferidos',
        'LinkedIn URL está correto e acessível',
        'Respostas de "custom questions" refletem experiência REAL',
        'Autorização de trabalho: resposta honesta e alinhada com a vaga',
        'Nível de inglês: condiz com realidade',
        'Checkboxes de consentimento: marcados conforme decisão',
        'Perguntas demográficas: respondidas conforme conforto pessoal',
        'Arquivos de anexo (PDFs) prontos para upload',
      ]
    : [
        'All personal data verified',
        'LinkedIn URL is correct and accessible',
        'Custom question answers reflect REAL experience',
        'Work authorization: honest answer aligned with role',
        'English level: matches reality',
        'Consent checkboxes: checked per decision',
        'Demographic questions: answered per personal comfort',
        'Attachment files (PDFs) ready for upload',
      ];
  for (const item of checklist) markdown += `- [ ] ${item}\n`;

  return markdown;
}

/** README for `materiais_extras` (port of `generateReadme`). */
export function renderSuggestionsReadme(language = 'en'): string {
  const isPt = language === 'pt-br';
  let readme = '# Materiais Extras - Perguntas de Candidatura\n\n';
  readme += `${
    isPt
      ? 'Esta pasta contém materiais de apoio para o preenchimento do formulário de candidatura.'
      : 'This folder contains supporting materials for filling out the application form.'
  }\n\n## Arquivos\n\n| Arquivo | Descrição |\n|---------|-----------|\n`;
  readme += `| \`sugestoes_respostas.md\` | ${
    isPt ? 'Versão legível para revisão humana' : 'Human-readable version for review'
  } |\n`;
  readme += `| \`sugestoes_respostas.json\` | ${
    isPt
      ? 'Versão estruturada (fonte da verdade, usada pelo app no pré-preenchimento)'
      : 'Structured version (source of truth, used by the app during pre-fill)'
  } |\n\n`;
  readme += '## Segurança / Security\n\n';
  readme += isPt
    ? '- `materiais_extras/` contém dados pessoais; não compartilhe publicamente.\n'
    : '- `materiais_extras/` contains personal data; do not share it publicly.\n';
  return readme;
}
