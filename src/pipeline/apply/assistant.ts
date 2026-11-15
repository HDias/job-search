import fs from 'node:fs';
import path from 'node:path';

/**
 * Assisted pre-fill dry-run (port of v1 `apply_assistant.mjs`).
 *
 * It fills the standard fields and attaches the resume PDF, captures a preview
 * screenshot and writes a report. It **never** clicks, submits or presses
 * anything: the human reviews the screenshot and sends the application.
 */

export interface ApplyElement {
  isVisible(): Promise<boolean>;
  fill(value: string): Promise<void>;
  setInputFiles?(filePath: string): Promise<void>;
}

export interface ApplyPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  waitForTimeout?(ms: number): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  $(selector: string): Promise<ApplyElement | null>;
  $$(selector: string): Promise<ApplyElement[]>;
  screenshot?(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  close?(): Promise<void>;
}

export interface ApplyContext {
  newPage(): Promise<ApplyPage>;
}

export interface ApplyBrowser {
  newContext(options: Record<string, unknown>): Promise<ApplyContext>;
  close?(): Promise<void>;
}

export interface CandidateData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface FieldPlan {
  field: string;
  selectors: string[];
  value: string;
}

export interface FilledField {
  field: string;
  selector: string;
  value?: string;
  file?: string;
}

export interface SubmitButtonInfo {
  text?: string;
  visible: boolean;
}

export interface DryRunReport {
  applicationUrl: string;
  timestamp: string;
  status: 'AGUARDANDO_APROVACAO_HUMANA';
  filledFields: FilledField[];
  resumeAttached: boolean;
  screenshotPath: string;
  reportPath: string;
  submitButtonDetected: SubmitButtonInfo;
  notice: string;
}

export interface AssistInput {
  url: string;
  candidate: CandidateData;
  resumePath: string | null;
  outputDir: string;
  headed?: boolean;
  browser?: ApplyBrowser;
  launchBrowser?: () => Promise<ApplyBrowser>;
  wait?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const NOTICE =
  'NENHUMA submissão foi realizada. O usuário deve revisar o screenshot e os campos antes de aprovar.';

export const SCREENSHOT_FILE = 'preview_before_submit.png';
export const REPORT_FILE = 'application_dry_run_report.json';

/** v1 selector order, kept verbatim so the dry-run behaves the same. */
export function buildFieldPlans(candidate: CandidateData): FieldPlan[] {
  const fullName = String(candidate.fullName ?? '').trim();
  const [firstWord = '', ...restWords] = fullName.split(' ').filter(Boolean);

  return [
    {
      field: 'Nome Completo',
      selectors: [
        'input[name*="name" i]:not([name*="first"]):not([name*="last"])',
        'input[id*="name" i]:not([id*="first"]):not([id*="last"])',
        'input[placeholder*="nome completo" i]',
        'input[placeholder*="full name" i]',
      ],
      value: fullName,
    },
    {
      field: 'Primeiro Nome',
      selectors: [
        'input[name*="first_name" i]',
        'input[name*="firstName" i]',
        'input[id*="first_name" i]',
        'input[placeholder*="primeiro nome" i]',
      ],
      value: String(candidate.firstName ?? firstWord).trim(),
    },
    {
      field: 'Sobrenome',
      selectors: [
        'input[name*="last_name" i]',
        'input[name*="lastName" i]',
        'input[id*="last_name" i]',
        'input[placeholder*="sobrenome" i]',
      ],
      value: String(candidate.lastName ?? restWords.join(' ')).trim(),
    },
    {
      field: 'Email',
      selectors: [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
      ],
      value: String(candidate.email ?? '').trim(),
    },
    {
      field: 'Telefone',
      selectors: [
        'input[type="tel"]',
        'input[name*="phone" i]',
        'input[id*="phone" i]',
        'input[placeholder*="telefone" i]',
        'input[placeholder*="celular" i]',
      ],
      value: String(candidate.phone ?? '').trim(),
    },
    {
      field: 'LinkedIn',
      selectors: [
        'input[name*="linkedin" i]',
        'input[id*="linkedin" i]',
        'input[placeholder*="linkedin" i]',
      ],
      value: String(candidate.linkedin ?? '').trim(),
    },
    {
      field: 'GitHub/Portfolio',
      selectors: [
        'input[name*="github" i]',
        'input[id*="github" i]',
        'input[name*="portfolio" i]',
        'input[name*="website" i]',
      ],
      value: String(candidate.github ?? candidate.portfolio ?? '').trim(),
    },
  ];
}

export async function launchApplyBrowser(
  headless = true,
): Promise<ApplyBrowser> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browser as unknown as ApplyBrowser;
}

/** Fills the first visible selector that matches; reports what it did. */
async function tryFill(
  page: ApplyPage,
  plan: FieldPlan,
): Promise<FilledField | null> {
  for (const selector of plan.selectors) {
    try {
      const element = await page.$(selector);
      if (!element) continue;
      if (!(await element.isVisible())) continue;
      await element.fill(plan.value);
      return { field: plan.field, selector, value: plan.value };
    } catch {
      // Missing selector or detached node: keep trying the next one.
    }
  }
  return null;
}

async function attachResume(
  page: ApplyPage,
  resumePath: string,
  warn: (message: string) => void,
): Promise<FilledField | null> {
  const fileInputs = await page.$$('input[type="file"]');
  const first = fileInputs[0];
  if (!first?.setInputFiles) return null;

  try {
    await first.setInputFiles(resumePath);
    return {
      field: 'Currículo (PDF)',
      selector: 'input[type="file"]',
      file: resumePath,
    };
  } catch (error) {
    warn(
      `Falha ao anexar currículo: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Reads the submit button for the report — it is never clicked. */
function detectSubmit(page: ApplyPage): Promise<SubmitButtonInfo> {
  return page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('button, input[type="submit"]'),
    );
    const submit = buttons.find((button) => {
      const element = button as HTMLButtonElement;
      const text = (element.innerText || element.value || '').toLowerCase();
      return (
        text.includes('enviar') ||
        text.includes('submit') ||
        text.includes('candidatar') ||
        text.includes('apply')
      );
    });
    if (!submit) return { visible: false };
    const element = submit as HTMLButtonElement;
    return {
      text: (element.innerText || element.value || '').trim(),
      visible: true,
    };
  });
}

export async function assistApplication(
  input: AssistInput,
): Promise<DryRunReport> {
  const warn = input.warn ?? ((message: string) => console.warn(message));
  const wait =
    input.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  fs.mkdirSync(input.outputDir, { recursive: true });

  const ownsBrowser = !input.browser;
  const browser =
    input.browser ??
    (await (input.launchBrowser ?? (() => launchApplyBrowser(!input.headed)))());

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 1000 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();

  try {
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (page.waitForTimeout) await page.waitForTimeout(3000);
    else await wait(3000);

    const filledFields: FilledField[] = [];
    let nameFilled = false;

    for (const plan of buildFieldPlans(input.candidate)) {
      if (!plan.value) continue;
      // v1 behaviour: a filled full name wins over the first/last pair.
      if (nameFilled && (plan.field === 'Primeiro Nome' || plan.field === 'Sobrenome')) {
        continue;
      }
      const filled = await tryFill(page, plan);
      if (!filled) continue;
      if (filled.field === 'Nome Completo') nameFilled = true;
      filledFields.push(filled);
    }

    let resumeAttached = false;
    if (input.resumePath && fs.existsSync(input.resumePath)) {
      const attached = await attachResume(page, input.resumePath, warn);
      if (attached) {
        resumeAttached = true;
        filledFields.push(attached);
      }
    }

    const submitButtonDetected = await detectSubmit(page);

    const screenshotPath = path.join(input.outputDir, SCREENSHOT_FILE);
    if (page.screenshot) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    const report: DryRunReport = {
      applicationUrl: input.url,
      timestamp: new Date().toISOString(),
      status: 'AGUARDANDO_APROVACAO_HUMANA',
      filledFields,
      resumeAttached,
      screenshotPath,
      reportPath: path.join(input.outputDir, REPORT_FILE),
      submitButtonDetected,
      notice: NOTICE,
    };

    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  } finally {
    if (page.close) await page.close();
    if (ownsBrowser && browser.close) await browser.close();
  }
}
