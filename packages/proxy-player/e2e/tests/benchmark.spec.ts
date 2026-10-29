import { expect, test, type CDPSession } from '@playwright/test';
import { createPlayer, FIXTURES, harness } from './helpers.js';

const DOWNLOAD_BYTES_PER_SEC = (1.6 * 1_000_000) / 8;

async function throttle(session: CDPSession): Promise<void> {
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: DOWNLOAD_BYTES_PER_SEC,
    uploadThroughput: DOWNLOAD_BYTES_PER_SEC,
    latency: 150,
  });
}

/**
 * Not correctness tests — these print the numbers docs/briefs/P4-proxy-
 * player.md's report section asks for (time-to-first-frame at 1.6 Mbps,
 * cache hit rate across a simulated 360° scrub) so the report can quote
 * real measurements instead of guesses. Playwright's own timing (test
 * duration) is not used for this — the in-page performance.now() delta is,
 * since it excludes IPC/evaluate round-trip overhead.
 */
test.describe('measurements for the report', () => {
  test('time-to-first-frame at 1.6 Mbps (3g-fast)', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await throttle(client);
    await page.goto('/');

    const id = await createPlayer(page, FIXTURES.av1);
    const first = await harness(page).waitFirstFrame(id);
    const bytes = await harness(page).getBytes(id);

    console.log(
      `[measurement] TTFV (av1, 1.6 Mbps): ${first.elapsedMs.toFixed(1)}ms, ` +
        `${bytes.loaded} of ${bytes.total} bytes loaded`,
    );
    expect(first.elapsedMs).toBeGreaterThan(0);
  });

  test('cache hit rate across one full 360° scrub (72 frames, prefetch radius 3)', async ({
    page,
  }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    const { hits, misses, total } = await harness(page).simulateScrub(id, 72, 3);
    const hitRate = (hits / total) * 100;
    console.log(
      `[measurement] scrub cache hit rate: ${hits}/${total} (${hitRate.toFixed(1)}%), ${misses} misses`,
    );
    expect(hits + misses).toBe(total);
  });
});
