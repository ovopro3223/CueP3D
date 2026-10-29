import { expect, test, type CDPSession } from '@playwright/test';
import { createPlayer, FIXTURES, harness } from './helpers.js';

const DOWNLOAD_BYTES_PER_SEC = (1.6 * 1_000_000) / 8; // "3g-fast" per docs/01-design.md §10

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
 * Milestone B. D-009's actual requirement: the first frame must be
 * displayable after the first keyframe arrives, not after the whole file.
 * Throttled to the 3g-fast preset, frame 0 (~5 KB including moov) should
 * resolve long before a meaningful fraction of the ~120 KB fixture has
 * downloaded.
 */
test.describe('streaming decode (milestone B)', () => {
  test('firstFrame resolves before 25% of the file has downloaded, throttled to 1.6 Mbps', async ({
    page,
  }) => {
    const client = await page.context().newCDPSession(page);
    await throttle(client);

    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    const { loaded, total } = await harness(page).waitFirstFrameAndBytes(id);

    expect(total).toBe(FIXTURES.av1.bytes);
    expect(loaded).toBeGreaterThan(0);
    expect(loaded / total).toBeLessThan(0.25);
  });

  test('available grows across multiple progress updates rather than jumping straight to full', async ({
    page,
  }) => {
    const client = await page.context().newCDPSession(page);
    await throttle(client);

    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      const avail = await harness(page).getAvailable(id);
      samples.push(avail.to);
      await page.waitForTimeout(80);
    }
    const distinctValues = new Set(samples);
    expect(distinctValues.size).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThanOrEqual(71);

    await expect.poll(async () => (await harness(page).getAvailable(id)).to).toBe(71);
  });
});
