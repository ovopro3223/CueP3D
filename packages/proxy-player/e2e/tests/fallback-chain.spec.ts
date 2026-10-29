import { expect, test, type Page } from '@playwright/test';
import { createPlayer, FIXTURES, generateReferenceFrame, harness } from './helpers.js';

async function disableVideoDecoder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'VideoDecoder', { value: undefined, configurable: true });
  });
}

async function disableVideoElementPlayback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLVideoElement.prototype as any).canPlayType = () => '';
  });
}

test.describe('<video> element fallback (milestone C)', () => {
  test.beforeEach(async ({ page }) => {
    await disableVideoDecoder(page);
  });

  test('createProxyPlayer falls back to <video> when VideoDecoder is unavailable', async ({ page }) => {
    await page.goto('/');
    const hasVideoDecoder = await page.evaluate(() => typeof window.VideoDecoder !== 'undefined');
    expect(hasVideoDecoder).toBe(false);

    const id = await createPlayer(page, FIXTURES.av1);
    const first = await harness(page).waitFirstFrame(id);
    expect(first.kind).toBe('HTMLVideoElement');
  });

  test('getFrame(17) resolves within 300ms of request and shows the right content', async ({
    page,
  }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    const result = await harness(page).getFrame(id, 17);
    expect(result.kind).toBe('HTMLVideoElement');
    expect(result.elapsedMs).toBeLessThan(300);

    const ref17 = await generateReferenceFrame(17);
    const diff = await harness(page).compareFrameToReference(id, 17, `http://localhost:4873/${ref17}`);
    expect(diff.meanAbsDiffPct).toBeLessThan(6);
  });

  test('rapid scrubbing coalesces to the latest requested frame', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    // Fire several getFrame() calls without awaiting between them —
    // milestone C requires outstanding seeks be capped to one and rapid
    // requests coalesced to the latest index, so every one of these
    // should settle on frame 40 (the last one requested).
    const results = await page.evaluate(async (playerId) => {
      const w = window as unknown as {
        Harness: { getFrame(id: number, index: number): Promise<{ kind: string }> };
      };
      const calls = [5, 12, 40].map((index) => w.Harness.getFrame(playerId, index));
      return Promise.all(calls);
    }, id);
    expect(results).toHaveLength(3);

    const ref40 = await generateReferenceFrame(40);
    const diff = await harness(page).compareFrameToReference(id, 40, `http://localhost:4873/${ref40}`);
    expect(diff.meanAbsDiffPct).toBeLessThan(6);
  });
});

test.describe('AVIF sequence fallback (milestone D)', () => {
  test.beforeEach(async ({ page }) => {
    await disableVideoDecoder(page);
    await disableVideoElementPlayback(page);
  });

  test('selectProxyVariant returns the AVIF variant when no video path is usable', async ({ page }) => {
    await page.goto('/');
    const canPlay = await page.evaluate(() =>
      document.createElement('video').canPlayType('video/mp4'),
    );
    expect(canPlay).toBe('');

    const selectedJson = await harness(page).selectVariant(
      JSON.stringify([FIXTURES.av1, FIXTURES.vp9, FIXTURES.avif]),
    );
    expect(selectedJson).not.toBeNull();
    const selected = JSON.parse(selectedJson as string) as { kind: string; codec: string };
    expect(selected.kind).toBe('image-sequence');
    expect(selected.codec).toBe('avif');
  });

  test('createProxyPlayer(avifVariant) decodes the correct frame via createImageBitmap', async ({
    page,
  }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.avif);
    const first = await harness(page).waitFirstFrame(id);
    expect(first.kind).toBe('ImageBitmap');

    const ref17 = await generateReferenceFrame(17);
    const diff = await harness(page).compareFrameToReference(id, 17, `http://localhost:4873/${ref17}`);
    expect(diff.meanAbsDiffPct).toBeLessThan(6);
  });

  test('available is the full range as soon as the sequence length is discovered', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.avif);
    await harness(page).waitFirstFrame(id);
    expect(await harness(page).getAvailable(id)).toEqual({ from: 0, to: 71 });
  });
});
