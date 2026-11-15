import { describe, expect, it } from 'vitest';
import { evaluateInPage } from '../src/pipeline/browser-eval.js';

function pageRunningScripts() {
  return {
    evaluate: async <T>(script: string): Promise<T> =>
      new Function(`return eval(${JSON.stringify(script)})`)() as T,
  };
}

describe('evaluateInPage', () => {
  it('runs the callback and returns its value', async () => {
    await expect(
      evaluateInPage(pageRunningScripts(), () => 42),
    ).resolves.toBe(42);
  });

  it('defines __name so keepNames-compiled callbacks run', async () => {
    const compiled = Object.assign(() => '', {
      toString: () =>
        '() => { const clean = __name((text) => text.trim(), "clean"); return clean(" ok "); }',
    });

    await expect(evaluateInPage(pageRunningScripts(), compiled)).resolves.toBe(
      'ok',
    );
  });
});
