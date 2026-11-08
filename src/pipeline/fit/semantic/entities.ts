/** Tech-domain entity extraction (port of v1 `semantic/entities.js`). */

import { TECH_GLOSSARY } from './glossary.js';
import { extractExperiencePatterns, normalizeText } from './tokenizer.js';

export function extractTechSkills(
  text: unknown,
  language = 'en',
): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();

  // 1. Direct glossary match (boundary-aware).
  for (const skill of TECH_GLOSSARY) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(normalized)) found.add(skill);
  }

  // 2. "X years of Y" / "X anos de Y" patterns.
  for (const { skill } of extractExperiencePatterns(text, language)) {
    if (skill.length > 2 && skill.length < 80) found.add(skill);
  }

  // 3. Extra patterns common in job postings.
  const additionalPatterns =
    language === 'pt'
      ? [
          /conhecimento\s+(?:em|de)\s+([\w\s.+#\-/]+)/gi,
          /domínio\s+(?:em|de)\s+([\w\s.+#\-/]+)/gi,
          /expertise\s+(?:em|de)\s+([\w\s.+#\-/]+)/gi,
          /proficiente\s+(?:em|de)\s+([\w\s.+#\-/]+)/gi,
        ]
      : [
          /knowledge\s+(?:of|in)\s+([\w\s.+#\-/]+)/gi,
          /expertise\s+(?:in|with)\s+([\w\s.+#\-/]+)/gi,
          /proficient\s+(?:in|with)\s+([\w\s.+#\-/]+)/gi,
          /strong\s+(?:background\s+)?(?:in|with)\s+([\w\s.+#\-/]+)/gi,
          /hands.?on\s+(?:experience\s+)?(?:with|in)\s+([\w\s.+#\-/]+)/gi,
        ];

  for (const pattern of additionalPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const skill = match[1].trim().toLowerCase();
      if (skill.length > 2 && skill.length < 80) found.add(skill);
    }
  }

  return Array.from(found);
}

export function extractTitles(text: unknown, language = 'en'): string[] {
  const patterns =
    language === 'pt'
      ? [
          /\b(?:pessoa\s+)?(?:desenvolvedor[a]?|engenheir[oa]|arquitet[oa]|tech\s+lead|staff\s+engineer|principal\s+engineer|engineering\s+manager|gerente\s+de\s+engenharia|cto|vp\s+de\s+eng|head\s+de\s+eng|head\s+de\s+engenharia)\b/gi,
          /\b(?:junior|pleno|senior|sênior|lead|staff|principal)\s+(?:developer|engineer|dev|engenheir[oa]|desenvolvedor[a]?|arquitet[oa])\b/gi,
          /\b(?:scrum\s+master|product\s+owner|product\s+manager|project\s+manager|delivery\s+manager|engineering\s+lead|technical\s+lead)\b/gi,
        ]
      : [
          /\b(?:software\s+)?(?:engineer|developer|architect|tech\s+lead|staff\s+engineer|principal\s+engineer|engineering\s+manager|cto|vp\s+engineering|head\s+of\s+engineering|director\s+of\s+engineering)\b/gi,
          /\b(?:junior|mid|senior|lead|staff|principal)\s+(?:developer|engineer|dev|architect|software\s+engineer)\b/gi,
          /\b(?:scrum\s+master|product\s+owner|product\s+manager|project\s+manager|delivery\s+manager|engineering\s+lead|technical\s+lead)\b/gi,
          /\b(?:solutions\s+architect|cloud\s+architect|data\s+architect|security\s+architect)\b/gi,
        ];

  const found = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(String(text ?? ''))) !== null) {
      found.add(normalizeText(match[0]));
    }
  }
  return Array.from(found);
}

export function extractCertifications(text: unknown): string[] {
  const certPatterns = [
    /\b(?:aws|azure|gcp|google cloud)\s+(?:certified|professional|associate|specialty|expert)\s+[\w\s\-]+/gi,
    /\b(?:aws|azure|gcp)\s+(?:solutions architect|developer|devops|sysops|security|machine learning|data analytics|database|networking)\s+\w+/gi,
    /\b(?:ckad|cka|cks|kcna|kcsa)\b/gi,
    /\b(?:pmp|prince2|scrum|psm|pspo|psd|pal|cal|clc|csm|csd|csp)\b/gi,
    /\b(?:cissp|cisa|cism|crisc|ceh|oscp|osce|oswe|gsec|gcih|gpci)\b/gi,
    /\b(?:oracle|java|spring|terraform|ansible|kafka|redis|mongodb|postgresql|mysql|elastic)\s+certified/gi,
    /\b(?:certified|certification)\s+(?:in|on|for)\s+[\w\s.+#]+/gi,
  ];

  const found = new Set<string>();
  for (const pattern of certPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(String(text ?? ''))) !== null) {
      found.add(normalizeText(match[0]));
    }
  }
  return Array.from(found);
}

const KNOWN_COMPANIES = new Set([
  'google', 'microsoft', 'amazon', 'aws', 'apple', 'meta', 'facebook', 'netflix',
  'nubank', 'quintoandar', 'loft', 'creditas', 'ebanol', 'mercadolivre', 'mercado livre',
  'ifood', 'rappi', 'loggi', '99', 'wildlife', 'gympass', 'c6 bank', 'inter',
  'stone', 'pagseguro', 'ebbanx', 'vtex', 'hotmart', 'samba tech', 'rd station',
  'uber', 'airbnb', 'stripe', 'shopify', 'square', 'block', 'coinbase', 'robinhood',
  'databricks', 'snowflake', 'confluent', 'hashicorp', 'gitlab', 'github', 'atlassian',
  'mongodb', 'elastic', 'redis', 'couchbase', 'cockroach labs', 'planetscale',
  'vercel', 'netlify', 'cloudflare', 'fastly', 'heroku', 'render', 'railway',
  'linear', 'notion', 'figma', 'miro', 'slack', 'discord', 'twitch',
  'thoughtworks', 'globant', 'endava', 'ciandt', 'accion labs', 'ci&t', 'cesar',
  'accenture', 'deloitte', 'pwc', 'ey', 'kpmg', 'ibm', 'oracle', 'sap',
]);

export function extractCompanies(text: unknown): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();

  for (const company of KNOWN_COMPANIES) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(normalized)) found.add(company);
  }

  return Array.from(found);
}

export function extractByCategory(
  text: unknown,
  language = 'en',
): Record<string, string[]> {
  const skills = extractTechSkills(text, language);
  const categorized: Record<string, string[]> = {
    languages: [],
    frameworks: [],
    databases: [],
    cloud: [],
    devops: [],
    testing: [],
    tools: [],
    other: [],
  };

  const categories: Record<string, string[]> = {
    languages: ['javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'ruby', 'php', 'c#', 'c++', 'swift', 'kotlin', 'scala', 'dart', 'elixir', 'clojure'],
    frameworks: ['react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'rails', 'django', 'spring boot', 'express', 'fastify', 'nestjs', 'fastapi', 'laravel', 'gin', 'echo', 'ember', 'remix', 'astro'],
    databases: ['postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'cassandra', 'clickhouse', 'snowflake', 'bigquery', 'sqlite', 'mariadb'],
    cloud: ['aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'ansible', 'helm', 'prometheus', 'grafana', 'datadog', 'newrelic', 'sentry'],
    devops: ['ci/cd', 'github actions', 'gitlab ci', 'jenkins', 'circleci', 'argo', 'flux', 'istio', 'kafka', 'rabbitmq'],
    testing: ['jest', 'vitest', 'cypress', 'playwright', 'testing library', 'rspec', 'pytest', 'phpunit'],
  };

  for (const skill of skills) {
    let categorizedFlag = false;
    for (const [category, terms] of Object.entries(categories)) {
      if (terms.some((term) => skill.includes(term) || term.includes(skill))) {
        categorized[category].push(skill);
        categorizedFlag = true;
        break;
      }
    }
    if (!categorizedFlag) categorized.other.push(skill);
  }

  return categorized;
}
