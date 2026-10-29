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
      waitForState(id: number, state: string, timeoutMs: number): Promise<boolean>;
      flingDuringDrag(id: number): Promise<void>;
      releasePointer(id: number): void;
      now(): number;
      dispose(id: number): void;
    };
  }
}

async function createViewerOnPage(page: Page): Promise<number> {
  return page.evaluate(({ options }) => window.Harness.create(JSON.stringify(options)), {
    options: { src: '/fixtures/out-cube/cuep3d.json', policy: FORCE_HIGH_END_POLICY },
  });
}

test.beforeEach(async ({ page }) => {
  // The fixture's L0 (a small, textureless sphere) now loads and warms in
  // well under 100ms — fast enough that, without this, warm() can resolve
  // and the handoff's one-time fast-drag check can run before
  // flingDuringDrag()'s own pointerdown→(30ms)→pointermove sequence has
  // finished arriving, flaking this test on an unrelated race in the test
  // itself (not the handoff rule). Same fix as handoff-pixel-diff.spec.ts.
  await page.route('**/fixtures/out-cube/model.L0.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto('/');
});

test('handoff waits out a fast drag instead of swapping mid-fling', async ({ page }) => {
  const id = await createViewerOnPage(page);
  await page.evaluate((id) => window.Harness.waitForState(id, 'proxy-ready', 10_000), id);

  await page.evaluate((id) => window.Harness.flingDuringDrag(id), id);

  // Give L0 comfortably enough time to load and warm — if the handoff
  // rule did not hold off on a fast drag, the viewer would already be
  // live well before this point.
  await page.waitForTimeout(400);
  const stateWhileFlinging = await page.evaluate((id) => window.Harness.getState(id), id);
  expect(['proxy-ready', 'warming']).toContain(stateWhileFlinging);

  await page.evaluate((id) => window.Harness.releasePointer(id), id);
  const reachedLive = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'live', 5_000),
    id,
  );
  expect(reachedLive).toBe(true);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});

test('an unreleased fast drag is overridden by the 1s cap', async ({ page }) => {
  const id = await createViewerOnPage(page);
  await page.evaluate((id) => window.Harness.waitForState(id, 'proxy-ready', 10_000), id);

  const t0 = await page.evaluate(() => window.Harness.now());
  await page.evaluate((id) => window.Harness.flingDuringDrag(id), id);
  // Never released, never slows down — only the cap can let this proceed.

  const reachedLive = await page.evaluate(
    (id) => window.Harness.waitForState(id, 'live', 5_000),
    id,
  );
  expect(reachedLive).toBe(true);
  const t1 = await page.evaluate(() => window.Harness.now());

  // >= the 1s cap (minus a little slack for the fling's own 30ms head
  // start and timer granularity), and comfortably bounded above so a
  // regression that waits forever would fail this, not just time out.
  expect(t1 - t0).toBeGreaterThan(900);
  expect(t1 - t0).toBeLessThan(3000);

  await page.evaluate((id) => window.Harness.dispose(id), id);
});
