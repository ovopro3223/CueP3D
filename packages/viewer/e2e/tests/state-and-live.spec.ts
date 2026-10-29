import { test, expect, type Page } from '@playwright/test';

const FORCE_HIGH_END_POLICY = {
  deviceMemory: 8,
  hardwareConcurrency: 8,
  connection: { effectiveType: '4g', downlink: 50 },
};

declare global {
  interface Window {
    Harness: {
      create(optionsJson: string): number;
      getState(id: number): string;
      getDegraded(id: number): boolean;
      getMetrics(id: number): unknown;
      getStateLog(id: number): string[];
      getErrorLog(id: number): string[];
      waitForState(id: number, state: string, timeoutMs: number): Promise<boolean>;
      dispose(id: number): void;
    };
  }
}

async function createViewerOnPage(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  return page.evaluate(({ options }) => window.Harness.create(JSON.stringify(options)), {
    options: {
      src: '/fixtures/out-cube/cuep3d.json',
      policy: FORCE_HIGH_END_POLICY,
      ...overrides,
    },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('reaches live then settled, walking through every state in order (3-tier fixture: 2 upgrades)', async ({
  page,
}) => {
  const id = await createViewerOnPage(page);

  const reachedSettled = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'settled', 15_000),
    id,
  );
  expect(reachedSettled).toBe(true);

  const log = await page.evaluate((id) => window.Harness.getStateLog(id), id);
  expect(log).toEqual([
    'proxy-loading',
    'proxy-ready',
    'warming',
    'handoff',
    'live',
    'upgrading',
    'live',
    'upgrading',
    'live',
    'settled',
  ]);

  const degraded = await page.evaluate((id) => window.Harness.getDegraded(id), id);
  expect(degraded).toBe(false);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});

test('metrics are populated and monotonic by the time the viewer settles', async ({ page }) => {
  const id = await createViewerOnPage(page);
  await page.evaluate((id) => window.Harness.waitForState(id, 'settled', 15_000), id);

  const metrics = await page.evaluate(
    (id) =>
      window.Harness.getMetrics(id) as {
        ttfv?: number;
        tti?: number;
        ttLive?: number;
        ttSettled?: number;
        bytesBeforeFirstVisual: number;
        bytesTotal: number;
      },
    id,
  );

  expect(metrics.ttfv).toBeGreaterThan(0);
  expect(metrics.ttLive).toBeGreaterThanOrEqual(metrics.ttfv!);
  expect(metrics.ttSettled).toBeGreaterThanOrEqual(metrics.ttLive!);
  expect(metrics.bytesBeforeFirstVisual).toBeGreaterThan(0);
  expect(metrics.bytesTotal).toBeGreaterThan(metrics.bytesBeforeFirstVisual);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});

test('an invalid manifest URL surfaces the error state with a readable message', async ({
  page,
}) => {
  const id = await createViewerOnPage(page, { src: '/fixtures/does-not-exist.json' });
  const reachedError = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'error', 10_000),
    id,
  );
  expect(reachedError).toBe(true);

  const errors = await page.evaluate((id) => window.Harness.getErrorLog(id), id);
  expect(errors.length).toBeGreaterThan(0);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});
