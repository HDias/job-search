/**
 * Chromium helpers shared by the application-question extractor.
 *
 * The old prefill dry-run was removed; only the browser contract and launcher
 * remain, and the queue/tests can inject their own browser.
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
  evaluate<T>(callback: string | (() => T)): Promise<T>;
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
