import { test, expect } from '@playwright/test';
import { waitForDebugState, waitForPaneState } from './helpers.js';

/**
 * Fast, unthrottled, one model (Avocado) — the brief's own distinction:
 * this runs in the normal test suite (`pnpm test` -> `pnpm -F bench test`),
 * the full three-preset x three-model sweep is `pnpm run bench` instead.
 * Two checks: the debug hook the real bench sweep depends on (per mode,
 * since `?debug=1` mirrors one pane's state at a time onto
 * `window.__cuep3dState`, see apps/demo/src/bench-hook.ts), and the
 * plain default page a human visitor actually gets (both panes, no query
 * params) reaching their own terminal state in the metrics-strip DOM.
 */
test.describe('demo smoke (unthrottled, Avocado)', () => {
  test('debug hook reports Plain reaching "rendered"', async ({ page }) => {
    await page.goto('/?model=avocado&mode=plain&debug=1');
    await waitForDebugState(page, 'rendered', 20_000);
  });

  test('debug hook reports CueP3D reaching "settled"', async ({ page }) => {
    await page.goto('/?model=avocado&mode=cuep3d&debug=1');
    await waitForDebugState(page, 'settled', 20_000);
  });

  test('default page: both panes reach their final state side by side', async ({ page }) => {
    await page.goto('/?model=avocado');
    await Promise.all([
      waitForPaneState(page, '#plain-metrics', 'rendered', 20_000),
      waitForPaneState(page, '#cuep3d-metrics', 'settled', 20_000),
    ]);
    await expect(page.locator('#plain-viewport canvas')).toBeVisible();
    await expect(page.locator('#cuep3d-viewport canvas')).toBeVisible();
  });
});
