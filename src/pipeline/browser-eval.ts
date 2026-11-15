/**
 * `page.evaluate` wrapper that survives the bundler's `keepNames` output.
 *
 * The API runs through `tsx`, which compiles every module with esbuild's
 * `keepNames`. That option wraps inner functions with `__name(...)` calls, and
 * Playwright serialises the callback with `fn.toString()`, so the calls reach
 * the browser and fail with `ReferenceError: __name is not defined`. The
 * prelude below defines the helper in the page before the callback executes.
 */

interface PageEvaluator {
  evaluate<T>(callback: string | (() => T)): Promise<T>;
}

export function evaluateInPage<T>(
  page: PageEvaluator,
  fn: () => T,
): Promise<T> {
  const source = [
    'globalThis.__name = globalThis.__name || ((target) => target);',
    `(${fn.toString()})();`,
  ].join('\n');
  return page.evaluate<T>(source);
}
