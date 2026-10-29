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
      waitForState(id: number, state: string, timeoutMs: number): Promise<boolean>;
      dispose(id: number): void;
      rendererMemory(): { geometries: number; textures: number } | null;
      outstandingRafCount(): number;
    };
  }
}

async function createViewerOnPage(page: Page): Promise<number> {
  return page.evaluate(({ options }) => window.Harness.create(JSON.stringify(options)), {
    options: { src: '/fixtures/out-cube/cuep3d.json', policy: FORCE_HIGH_END_POLICY },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('dispose() releases every GPU resource, the render loop, and the canvas element', async ({
  page,
}) => {
  const id = await createViewerOnPage(page);

  await page.evaluate((id) => window.Harness.waitForState(id, 'proxy-loading', 10_000), id);
  const baseline = await page.evaluate(() => window.Harness.rendererMemory());
  expect(baseline).not.toBeNull();

  const reachedSettled = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'settled', 15_000),
    id,
  );
  expect(reachedSettled).toBe(true);

  const afterSettle = await page.evaluate(() => window.Harness.rendererMemory());
  expect(afterSettle!.geometries).toBeGreaterThan(baseline!.geometries);
  expect(afterSettle!.textures).toBeGreaterThan(baseline!.textures);

  const rafBeforeDispose = await page.evaluate(() => window.Harness.outstandingRafCount());
  expect(rafBeforeDispose).toBeGreaterThan(0);

  await page.evaluate((id) => window.Harness.dispose(id), id);
  // Let any in-flight rAF callback actually fire (or not) before checking.
  await page.waitForTimeout(100);

  const afterDispose = await page.evaluate(() => window.Harness.rendererMemory());
  expect(afterDispose).toEqual(baseline);

  const rafAfterDispose = await page.evaluate(() => window.Harness.outstandingRafCount());
  expect(rafAfterDispose).toBe(0);

  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
  expect(canvasCount).toBe(0);
});

test('disposing mid-flight (before settled) does not throw and still cleans up', async ({
  page,
}) => {
  const id = await createViewerOnPage(page);
  await page.evaluate((id) => window.Harness.waitForState(id, 'proxy-ready', 10_000), id);

  await page.evaluate((id) => window.Harness.dispose(id), id);
  await page.waitForTimeout(200);

  const rafAfterDispose = await page.evaluate(() => window.Harness.outstandingRafCount());
  expect(rafAfterDispose).toBe(0);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.waitForTimeout(200);
  expect(pageErrors).toEqual([]);
});
