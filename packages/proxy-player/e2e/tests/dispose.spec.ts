import { expect, test } from '@playwright/test';
import { createPlayer, FIXTURES, harness } from './helpers.js';

test.describe('dispose()', () => {
  test('WebCodecs player: getFrame rejects and no new fetches start after dispose', async ({
    page,
  }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    const before = await harness(page).resourceUrlsMatching('proxy-fixture.av1.mp4');
    harness(page).disposePlayer(id);
    // getFrame on an unseen index would need to decode (and thus fetch),
    // so this is the case that actually proves abort() stopped the pump.
    const rejected = await harness(page).expectGetFrameRejects(id, 55);

    await page.waitForTimeout(300);
    const after = await harness(page).resourceUrlsMatching('proxy-fixture.av1.mp4');

    expect(rejected).toBe(true);
    expect(after.length).toBe(before.length);
  });

  test('AVIF player: getFrame rejects after dispose', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.avif);
    await harness(page).waitFirstFrame(id);

    harness(page).disposePlayer(id);
    const rejected = await harness(page).expectGetFrameRejects(id, 55);
    expect(rejected).toBe(true);
  });

  test('<video> player: getFrame rejects after dispose', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'VideoDecoder', { value: undefined, configurable: true });
    });
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    harness(page).disposePlayer(id);
    const rejected = await harness(page).expectGetFrameRejects(id, 55);
    expect(rejected).toBe(true);
  });

  test('disposing before firstFrame settles still rejects firstFrame', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    harness(page).disposePlayer(id);
    const rejected = await harness(page).expectGetFrameRejects(id, 0);
    expect(rejected).toBe(true);
  });
});
