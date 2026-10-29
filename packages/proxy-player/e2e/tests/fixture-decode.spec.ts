import { expect, test } from '@playwright/test';
import { createPlayer, FIXTURES, referenceFrame, harness } from './helpers.js';

/**
 * Milestone A. Decodes real frames from the committed AV1 fixture and
 * checks them against the committed ground-truth PNG for the *same* frame
 * index — not just "some" frame. Measured on this fixture with explicit
 * colour metadata in the bitstream (D-012): a correctly-decoded frame sits
 * at ~1.2-1.3% mean abs diff from its own reference (AV1 compression noise
 * plus 4:2:0 chroma, nothing else); comparing against a reference from the
 * *opposite side of the orbit* (deliberately far rather than the adjacent
 * frame, whose content is naturally close since testsrc2 moves
 * continuously) reads 8-10%. That gap — not an arbitrary absolute number —
 * is what actually proves the correct index was decoded. Before D-012 the
 * same comparison read ~4% here and ~8% on Linux CI: with no colour config
 * in the stream, each platform's WebCodecs path guessed a different
 * YUV->RGB matrix/range (see packages/build-encode/src/color.ts).
 */
test.describe('whole-file WebCodecs decode (milestone A)', () => {
  test('firstFrame resolves to a 256x256 VideoFrame', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    const first = await harness(page).waitFirstFrame(id);
    expect(first.kind).toBe('VideoFrame');
    expect(first.width).toBe(256);
    expect(first.height).toBe(256);
  });

  test('available becomes {0,71} once the whole file has parsed', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);
    await expect.poll(async () => harness(page).getAvailable(id)).toEqual({ from: 0, to: 71 });
  });

  for (const index of [0, 17, 71]) {
    test(`frame ${index} decodes to its own reference, not a distant frame's`, async ({ page }) => {
      await page.goto('/');
      const id = await createPlayer(page, FIXTURES.av1);
      await harness(page).waitFirstFrame(id);

      const ownRef = referenceFrame(index);
      const farIndex = (index + 36) % 72; // opposite side of the 72-frame orbit
      const farRef = referenceFrame(farIndex);

      const matching = await harness(page).compareFrameToReference(
        id,
        index,
        `http://localhost:4873/${ownRef}`,
      );
      const mismatched = await harness(page).compareFrameToReference(
        id,
        index,
        `http://localhost:4873/${farRef}`,
      );

      console.log(
        `frame ${index}: own-reference diff ${matching.meanAbsDiffPct.toFixed(3)}%, ` +
          `far-reference (frame ${farIndex}) diff ${mismatched.meanAbsDiffPct.toFixed(3)}%`,
      );
      expect(matching.meanAbsDiffPct).toBeLessThan(6);
      // The far frame's diff is pure content difference now (measured
      // 8.1-10.3%), so the absolute floor sits below it and the real check
      // is the ratio: measured 6-8x, asserted 3x.
      expect(mismatched.meanAbsDiffPct).toBeGreaterThan(6);
      expect(mismatched.meanAbsDiffPct).toBeGreaterThan(matching.meanAbsDiffPct * 3);
    });
  }

  test('GOP-aware random access: frame 13 decodes correctly without visiting 0..12 first', async ({
    page,
  }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    const ref13 = referenceFrame(13);
    const result = await harness(page).compareFrameToReference(
      id,
      13,
      `http://localhost:4873/${ref13}`,
    );
    expect(result.meanAbsDiffPct).toBeLessThan(6);
  });

  test('scrubbing both directions across a GOP boundary stays correct', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.av1);
    await harness(page).waitFirstFrame(id);

    // 7 -> 8 (keyframe) -> 6: forward into a new GOP, then back into the
    // previous one, exercising both the incremental and random-access paths.
    for (const index of [7, 8, 6]) {
      const ref = referenceFrame(index);
      const result = await harness(page).compareFrameToReference(
        id,
        index,
        `http://localhost:4873/${ref}`,
      );
      expect(result.meanAbsDiffPct).toBeLessThan(6);
    }
  });
});

test.describe('VP9 variant via WebCodecs (D-004 fallback tier)', () => {
  test('decodes the VP9 fixture correctly, not just the AV1 one', async ({ page }) => {
    await page.goto('/');
    const id = await createPlayer(page, FIXTURES.vp9);
    const first = await harness(page).waitFirstFrame(id);
    expect(first.kind).toBe('VideoFrame');

    const ref17 = referenceFrame(17);
    const result = await harness(page).compareFrameToReference(
      id,
      17,
      `http://localhost:4873/${ref17}`,
    );
    expect(result.meanAbsDiffPct).toBeLessThan(6);
  });
});
