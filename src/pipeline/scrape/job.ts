/**
 * Playwright job scraper (port of the v1 `scrape_job.mjs`).
 *
 * Greenhouse shortcut: `?gh_jid=<id>` pages load the posting in a
 * cross-origin iframe, so the public boards API is used instead of rendering.
 * The browser is injectable so the queue can reuse one Chromium instance and
 * tests never launch a real browser.
 */

import { detectLanguageScores } from '../content.js';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export interface ScrapedJob {
  url: string;
  scrapedAt: string;
  title: string;
  company: string;
  location: string;
  applyUrl: string;
  detectedLanguage: 'pt-br' | 'en';
  languageConfidence: { ptScore: number; enScore: number };
  content: string;
  via?: 'greenhouse-api' | 'playwright';
}

export interface ScrapePage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  waitForTimeout?(ms: number): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  close?(): Promise<void>;
}

export interface ScrapeContext {
  newPage(): Promise<ScrapePage>;
  close?(): Promise<void>;
}

export interface ScrapeBrowser {
  newContext(options: Record<string, unknown>): Promise<ScrapeContext>;
  close?(): Promise<void>;
}

export type BrowserLauncher = () => Promise<ScrapeBrowser>;

export interface ScrapeDeps {
  fetchImpl?: typeof fetch;
  /** Shared browser (queue worker). When omitted, a browser is launched and closed per scrape. */
  browser?: ScrapeBrowser;
  launchBrowser?: BrowserLauncher;
  /** Test hook: skip the `waitForTimeout` delay. */
  wait?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
}

interface BrowserEvaluateData {
  pageTitle: string;
  extractedTitle: string;
  company: string;
  location: string;
  applyHref: string;
  fullText: string;
}

function decodeEntitiesOnce(value: string): string {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function greenhouseHtmlToText(content: string): string {
  let text = String(content || '');
  for (let i = 0; i < 3 && /&(lt|gt|quot|amp);/.test(text); i++) {
    text = decodeEntitiesOnce(text);
  }
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text
    .replace(/<\/(p|li|div|h\d|ul|ol|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntitiesOnce(text);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Greenhouse public API when the URL has `?gh_jid=<id>`; null when not applicable. */
export async function scrapeGreenhouseApi(
  url: string,
  deps: Pick<ScrapeDeps, 'fetchImpl' | 'warn'> = {},
): Promise<ScrapedJob | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const match = String(url || '').match(/[?&]gh_jid=(\d+)/);
  if (!match) return null;
  const jobId = match[1];

  let token: string | null = null;
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    const html = await response.text();
    const tokenMatch = html.match(/job_board\/js\?for=([\w-]+)/);
    if (tokenMatch) token = tokenMatch[1];
  } catch (err) {
    warn(
      `[Scraper] Falha ao descobrir board token Greenhouse: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!token) {
    warn(
      '[Scraper] gh_jid presente mas board token não encontrado — caindo para Playwright.',
    );
    return null;
  }

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${jobId}`;
  const response = await fetchImpl(apiUrl);
  if (!response.ok) {
    throw new Error(
      `Greenhouse API retornou HTTP ${response.status} (board=${token} job=${jobId})`,
    );
  }
  const data = (await response.json()) as {
    content?: string;
    title?: string;
    company_name?: string;
    location?: { name?: string };
    absolute_url?: string;
  };
  if (!data?.content) {
    throw new Error(
      `Vaga ${jobId} sem conteúdo na API do Greenhouse (board=${token})`,
    );
  }

  const text = greenhouseHtmlToText(data.content);
  const language = detectLanguageScores(text);
  return {
    url,
    scrapedAt: new Date().toISOString(),
    title: data.title || '',
    company: data.company_name || 'Empresa a confirmar',
    location: data.location?.name || 'Não especificada',
    applyUrl: data.absolute_url || url,
    detectedLanguage: language.detectedLanguage,
    languageConfidence: {
      ptScore: language.ptScore,
      enScore: language.enScore,
    },
    content: text,
    via: 'greenhouse-api',
  };
}

async function defaultLauncher(): Promise<ScrapeBrowser> {
  // Loaded lazily so importing the pipeline never requires the browser binary.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browser as unknown as ScrapeBrowser;
}

export async function scrapeJob(
  url: string,
  deps: ScrapeDeps = {},
): Promise<ScrapedJob> {
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  // Greenhouse shortcut first.
  try {
    const greenhouse = await scrapeGreenhouseApi(url, deps);
    if (greenhouse) return greenhouse;
  } catch (err) {
    warn(
      `[Scraper] Atalho Greenhouse falhou, tentando Playwright: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const ownsBrowser = !deps.browser;
  const browser =
    deps.browser ?? (await (deps.launchBrowser ?? defaultLauncher)());
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  let page: ScrapePage | null = null;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (deps.wait) await deps.wait(3000);
    else if (page.waitForTimeout) await page.waitForTimeout(3000);

    const data = (await page.evaluate(() => {
      const clean = (text: string | null | undefined): string =>
        text ? text.replace(/\s+/g, ' ').trim() : '';

      const title =
        document.querySelector('h1')?.textContent ||
        document.querySelector('[data-automation-id="jobPostingHeader"]')
          ?.textContent ||
        document.title ||
        '';

      const company =
        document.querySelector('[data-automation-id="company-name"]')
          ?.textContent ||
        document.querySelector('.company-name')?.textContent ||
        document.querySelector('.employer')?.textContent ||
        document.querySelector('[class*="company"]')?.textContent ||
        '';

      const location =
        document.querySelector('[data-automation-id="job-location"]')
          ?.textContent ||
        document.querySelector('.location')?.textContent ||
        document.querySelector('[class*="location"]')?.textContent ||
        '';

      const clone = document.body.cloneNode(true) as HTMLElement;
      const remove = clone.querySelectorAll(
        'script, style, noscript, nav, footer, header, svg',
      );
      remove.forEach((element) => element.remove());
      const fullText = clone.innerText || '';

      const applyButton = document.querySelector(
        'a[href*="apply"], button[id*="apply"], a[class*="apply"]',
      );
      const applyHref = applyButton?.getAttribute('href') || '';

      return {
        pageTitle: document.title,
        extractedTitle: clean(title),
        company: clean(company),
        location: clean(location),
        applyHref,
        fullText: fullText.trim(),
      };
    })) as BrowserEvaluateData;

    const language = detectLanguageScores(data.fullText);
    let applyUrl = url;
    if (data.applyHref) {
      try {
        applyUrl = new URL(data.applyHref, url).href;
      } catch {
        applyUrl = url;
      }
    }

    return {
      url,
      scrapedAt: new Date().toISOString(),
      title: data.extractedTitle || data.pageTitle,
      company: data.company || 'Empresa a confirmar',
      location: data.location || 'Não especificada',
      applyUrl,
      detectedLanguage: language.detectedLanguage,
      languageConfidence: {
        ptScore: language.ptScore,
        enScore: language.enScore,
      },
      content: data.fullText,
      via: 'playwright',
    };
  } finally {
    if (page?.close) await page.close();
    else if (context.close) await context.close();
    if (ownsBrowser && browser.close) await browser.close();
  }
}
