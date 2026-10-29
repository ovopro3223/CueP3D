import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __cuep3dState?: string;
  }
}

export async function waitForDebugState(
  page: Page,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction((state) => window.__cuep3dState === state, expected, {
    timeout: timeoutMs,
    polling: 100,
  });
}

export async function waitForPaneState(
  page: Page,
  metricsSelector: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ selector, state }) => {
      const dd = document.querySelector(`${selector} dd.state-value`);
      return dd?.textContent === state;
    },
    { selector: metricsSelector, state: expected },
    { timeout: timeoutMs, polling: 100 },
  );
}
