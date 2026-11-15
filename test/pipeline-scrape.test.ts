import { beforeEach, describe, expect, it, vi } from 'vitest';

const launch = vi.hoisted(() => vi.fn());

vi.mock('playwright', () => ({
  chromium: { launch },
}));

import { scrapeJob } from '../src/pipeline/scrape/job.js';

describe('scrapeJob', () => {
  beforeEach(() => {
    launch.mockReset();
  });

  it('turns a missing browser into an actionable message', async () => {
    launch.mockRejectedValue(
      new Error(
        "browserType.launch: Executable doesn't exist at /home/user/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
      ),
    );

    await expect(
      scrapeJob('https://example.com/job', { warn: () => {} }),
    ).rejects.toThrow('pnpm exec playwright install chromium');
  });

  it('keeps unrelated launch errors unchanged', async () => {
    launch.mockRejectedValue(new Error('failed to launch chromium'));

    await expect(
      scrapeJob('https://example.com/job', { warn: () => {} }),
    ).rejects.toThrow('failed to launch chromium');
  });
});
