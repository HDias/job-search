import fs from 'node:fs';
import path from 'node:path';
import {
  launchApplyBrowser,
  type ApplyBrowser,
  type ApplyPage,
} from './assistant.js';

/**
 * Application form question extraction (port of v1
 * `scrape_application_questions.mjs`).
 *
 * The DOM walk happens inside one `page.evaluate`; everything after it
 * (platform detection, standard-field mapping, categorisation, dedupe) is pure
 * and covered by unit tests. The result is written as
 * `application_questions.json` in the job's artifact folder.
 */

export type AtsPlatform = 'greenhouse' | 'lever' | 'workable' | 'generic';

export type QuestionCategory =
  | 'upload'
  | 'personal'
  | 'legal'
  | 'demographic'
  | 'custom';

export interface FormControl {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  name: string;
}

export interface ApplicationQuestion extends FormControl {
  category: QuestionCategory;
}

export interface StandardField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  name: string;
}

export interface QuestionsResult {
  applicationUrl: string;
  scrapedAt: string;
  platform: AtsPlatform;
  questions: ApplicationQuestion[];
  standardFields: StandardField[];
}

export interface ScrapeQuestionsInput {
  url: string;
  outputDir?: string;
  browser?: ApplyBrowser;
  launchBrowser?: () => Promise<ApplyBrowser>;
  wait?: (ms: number) => Promise<void>;
}

export const QUESTIONS_FILE = 'application_questions.json';

export function detectAtsPlatform(url: string): AtsPlatform {
  const lower = String(url ?? '').toLowerCase();
  if (lower.includes('greenhouse.io') || lower.includes('grnhse')) {
    return 'greenhouse';
  }
  if (lower.includes('lever.co')) return 'lever';
  if (lower.includes('workable.com')) return 'workable';
  return 'generic';
}

const UPLOAD_HINTS = [
  'resume',
  'cv',
  'cover letter',
  'attach',
  'upload',
  'file',
];

const URL_FIELD_HINTS = ['linkedin', 'github', 'portfolio', 'website'];

const PERSONAL_PATTERNS = [
  /first\s+name/i,
  /last\s+name/i,
  /full\s+name/i,
  /preferred\s+name/i,
  /email/i,
  /phone/i,
  /mobile/i,
  /telephone/i,
  /address/i,
  /^city$/i,
  /\bstate\b/i,
  /zip/i,
  /postal\s+code/i,
  /^country$/i,
  /linkedin\s+profile/i,
  /github/i,
  /portfolio/i,
  /website/i,
  /linked\s+in/i,
];

const LEGAL_HINTS = [
  'authorized to work',
  'work authorization',
  'visa',
  'sponsorship',
  'citizen',
  'permanent resident',
  'green card',
  'citizenship',
  'consent',
  'privacy',
  'data processing',
  'gdpr',
  'lgpd',
  'background check',
  'drug test',
  'criminal record',
  'work for.*in the past',
  'interviewed with.*in the past',
  'considering my application for future',
];

const DEMOGRAPHIC_HINTS = [
  'gender',
  'race',
  'ethnicity',
  'veteran',
  'disability',
  'sexual orientation',
  'transgender',
  'hispanic',
  'latino',
  'voluntary',
  'optional',
  'self-identification',
  'eeo',
  'prefer not to answer',
  'racial',
  'ethnic background',
];

export function categorizeQuestion(
  label: string,
  type: string,
): QuestionCategory {
  const lower = String(label ?? '').toLowerCase();

  const isUpload =
    type === 'file' || UPLOAD_HINTS.some((hint) => lower.includes(hint));
  // Profile URLs are text inputs, not attachments.
  if (isUpload) {
    return URL_FIELD_HINTS.some((hint) => lower.includes(hint))
      ? 'personal'
      : 'upload';
  }

  if (PERSONAL_PATTERNS.some((pattern) => pattern.test(lower))) {
    return 'personal';
  }
  if (LEGAL_HINTS.some((hint) => lower.includes(hint))) return 'legal';
  if (DEMOGRAPHIC_HINTS.some((hint) => lower.includes(hint))) {
    return 'demographic';
  }
  return 'custom';
}

const STANDARD_FIELD_NAMES = [
  'first_name',
  'last_name',
  'name',
  'email',
  'phone',
  'resume',
  'cover_letter',
  'linkedin',
  'github',
  'portfolio',
  'website',
];

/** Maps a control to a canonical standard field, or `null` when custom. */
export function standardFieldId(control: FormControl): string | null {
  const name = String(control.name ?? '').toLowerCase();
  const id = String(control.id ?? '').toLowerCase();
  const label = String(control.label ?? '').toLowerCase();

  const matches = (needle: string): boolean =>
    name.includes(needle) || id.includes(needle) || label.includes(needle);

  if (!STANDARD_FIELD_NAMES.some((needle) => matches(needle))) return null;

  if (matches('first_name') || label.includes('first name')) return 'first_name';
  if (matches('last_name') || label.includes('last name')) return 'last_name';
  if (matches('email')) return 'email';
  if (matches('phone')) return 'phone';
  if (matches('resume') || label.includes('cv')) return 'resume';
  if (matches('cover')) return 'cover_letter';
  if (matches('linkedin')) return 'linkedin';
  if (matches('github')) return 'github';
  if (matches('portfolio') || matches('website')) return 'portfolio';
  return 'unknown';
}

const NOISE_IDS = ['search-input', 'country-listbox'];
const NOISE_LABELS = ['List of countries', 'Search'];

function isNoise(control: FormControl): boolean {
  const id = String(control.id ?? '').toLowerCase();
  if (NOISE_IDS.some((needle) => id.includes(needle))) return true;
  if (NOISE_LABELS.includes(control.label.trim())) return true;
  // A bare "Yes" checkbox is an option of the question above it.
  if (control.type === 'checkbox' && control.label.trim() === 'Yes') return true;
  return false;
}

export function splitFields(controls: FormControl[]): {
  questions: ApplicationQuestion[];
  standardFields: StandardField[];
} {
  const seenFields = new Set<string>();
  const seenQuestions = new Set<string>();
  const seenStandard = new Set<string>();
  const questions: ApplicationQuestion[] = [];
  const standardFields: StandardField[] = [];

  for (const control of controls) {
    if (control.type === 'hidden') continue;
    if (control.type === 'submit' || control.type === 'button') continue;
    if (!control.label.trim() && !control.id && !control.name) continue;

    const key = `${control.label}|${control.id}|${control.name}`;
    if (seenFields.has(key)) continue;
    seenFields.add(key);

    if (isNoise(control)) continue;
    if (!control.label.trim()) continue;

    const standardId = standardFieldId(control);
    if (standardId) {
      // One entry per canonical field: forms often expose repeated e-mail inputs.
      if (standardId === 'unknown' || seenStandard.has(standardId)) continue;
      seenStandard.add(standardId);
      standardFields.push({
        id: standardId,
        label: control.label,
        type: control.type,
        required: control.required,
        options: control.options,
        name: control.name,
      });
      continue;
    }

    const labelKey = control.label.toLowerCase().trim();
    if (seenQuestions.has(labelKey)) continue;
    seenQuestions.add(labelKey);

    questions.push({
      ...control,
      category: categorizeQuestion(control.label, control.type),
    });
  }

  return { questions, standardFields };
}

export function buildQuestionsResult(input: {
  url: string;
  platform: AtsPlatform;
  controls: FormControl[];
  scrapedAt?: string;
}): QuestionsResult {
  const { questions, standardFields } = splitFields(input.controls);
  return {
    applicationUrl: input.url,
    scrapedAt: input.scrapedAt ?? new Date().toISOString(),
    platform: input.platform,
    questions,
    standardFields,
  };
}

/**
 * One DOM walk for every ATS: label, type, required and options are read with
 * the v1 heuristics. Kept self-contained because Playwright serialises it.
 */
function collectFormControls(): FormControl[] {
  function labelText(input: Element): string {
    const element = input as HTMLInputElement;
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return (label as HTMLElement).innerText.trim();
    }
    const parent = element.closest('label');
    if (parent) return (parent as HTMLElement).innerText.trim();

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (element.placeholder) return element.placeholder.trim();

    const previous = element.previousElementSibling;
    if (previous && previous.tagName === 'LABEL') {
      return (previous as HTMLElement).innerText.trim();
    }

    const container = element.closest(
      '.field, .form-field, .question, div[class*="field"], div[class*="question"]',
    );
    if (container) {
      const inner = container.querySelector(
        'label, .label, .question-text, [class*="label"]',
      );
      if (inner) return (inner as HTMLElement).innerText.trim();
    }
    return '';
  }

  function options(select: Element): string[] | null {
    const result: string[] = [];
    if (select.tagName === 'SELECT') {
      const optionsList = (select as HTMLSelectElement).options;
      for (const option of Array.from(optionsList)) {
        const text = option.innerText.trim();
        if (option.value && option.value !== '' && text !== 'Select...') {
          result.push(text);
        }
      }
    }
    return result.length > 0 ? result : null;
  }

  function required(input: Element): boolean {
    const element = input as HTMLInputElement;
    if (element.required || element.hasAttribute('required')) return true;
    if (element.getAttribute('aria-required') === 'true') return true;
    if (labelText(input).includes('*')) return true;
    return Boolean(
      input.closest('.required, [class*="required"], .field-required'),
    );
  }

  function type(input: Element): string {
    if (input.tagName === 'SELECT') return 'select';
    if (input.tagName === 'TEXTAREA') return 'textarea';
    const element = input as HTMLInputElement;
    if (element.type) return element.type;
    const role = element.getAttribute('role');
    if (role === 'combobox' || role === 'listbox') return 'select';
    return 'text';
  }

  const controls = document.querySelectorAll(
    'input, select, textarea, [role="combobox"], [role="listbox"], [role="textbox"]',
  );

  const fields: FormControl[] = [];
  for (const input of Array.from(controls)) {
    const element = input as HTMLInputElement;
    const controlType = type(input);
    const label = labelText(input);
    if (!label && !element.id && !element.name) continue;
    fields.push({
      id: element.id || element.name || '',
      label,
      type: controlType,
      required: required(input),
      options: controlType === 'select' ? options(input) : null,
      name: element.name || element.getAttribute('data-field-name') || '',
    });
  }
  return fields;
}

export async function scrapeApplicationQuestions(
  input: ScrapeQuestionsInput,
): Promise<QuestionsResult> {
  const wait =
    input.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const ownsBrowser = !input.browser;
  const browser =
    input.browser ?? (await (input.launchBrowser ?? (() => launchApplyBrowser()))());
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: 'en-US',
  });
  const page: ApplyPage = await context.newPage();

  try {
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (page.waitForTimeout) await page.waitForTimeout(3000);
    else await wait(3000);

    const controls = await page.evaluate(collectFormControls);
    const result = buildQuestionsResult({
      url: input.url,
      platform: detectAtsPlatform(input.url),
      controls,
    });

    if (input.outputDir) {
      fs.mkdirSync(input.outputDir, { recursive: true });
      fs.writeFileSync(
        path.join(input.outputDir, QUESTIONS_FILE),
        JSON.stringify(result, null, 2),
        'utf8',
      );
    }

    return result;
  } finally {
    if (page.close) await page.close();
    if (ownsBrowser && browser.close) await browser.close();
  }
}
