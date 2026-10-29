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
  // The baseline must see the stage's own allocations only. Since D-013
  // the first proxy frame is uploaded synchronously the moment
  // 'proxy-ready' fires, and on a fast runner that can land before the
  // round trip that reads the baseline below (seen on CI: the baseline
  // counted the overlay texture, so the correctly-freed count after
  // dispose read one lower). Holding the proxy fetch back makes the
  // ordering deterministic, the same way handoff-pixel-diff.spec.ts holds
  // L0 back to keep the scrub ahead of warm().
  let proxyHeld = true;
  await page.route('**/fixtures/out-cube/proxy-256.*', async (route) => {
    while (proxyHeld) await new Promise((resolve) => setTimeout(resolve, 25));
    await route.continue();
  });
  // Same reasoning for the inline poster (D-014): it is decoded and
  // uploaded ~20 ms after the manifest arrives, with no request to hold
  // back, so serve this test a manifest without it.
  await page.route('**/fixtures/out-cube/cuep3d.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as { proxy: { poster?: unknown } };
    delete manifest.proxy.poster;
    await route.fulfill({ response, json: manifest });
  });

  const id = await createViewerOnPage(page);

  await page.evaluate((id) => window.Harness.waitForState(id, 'proxy-loading', 10_000), id);
  const baseline = await page.evaluate(() => window.Harness.rendererMemory());
  expect(baseline).not.toBeNull();
  proxyHeld = false;

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
