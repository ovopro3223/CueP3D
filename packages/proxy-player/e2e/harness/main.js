/* global window, fetch, performance, createImageBitmap, OffscreenCanvas */
/* global VideoFrame, ImageBitmap, HTMLVideoElement, HTMLImageElement */
import { createProxyPlayer, selectProxyVariant } from '/dist/index.js';

const players = new Map();
let nextId = 1;

function getPlayer(id) {
  const player = players.get(id);
  if (!player) throw new Error(`No player with id ${id}`);
  return player;
}

function frameSize(frame) {
  if ('displayWidth' in frame) return { width: frame.displayWidth, height: frame.displayHeight };
  if ('videoWidth' in frame) return { width: frame.videoWidth, height: frame.videoHeight };
  return { width: frame.width, height: frame.height };
}

function frameKind(frame) {
  if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) return 'VideoFrame';
  if (typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap) return 'ImageBitmap';
  if (typeof HTMLVideoElement !== 'undefined' && frame instanceof HTMLVideoElement) return 'HTMLVideoElement';
  if (typeof HTMLImageElement !== 'undefined' && frame instanceof HTMLImageElement) return 'HTMLImageElement';
  return 'unknown';
}

async function loadReferenceBitmap(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch reference image ${url}: ${response.status}`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function diffCanvases(actualData, expectedData) {
  // RGB channels only — alpha is opaque (255) in both images and would
  // only dilute the comparison toward zero without saying anything about
  // whether the right frame decoded.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < actualData.length; i += 4) {
    sum += Math.abs(actualData[i] - expectedData[i]);
    sum += Math.abs(actualData[i + 1] - expectedData[i + 1]);
    sum += Math.abs(actualData[i + 2] - expectedData[i + 2]);
    count += 3;
  }
  return (sum / count / 255) * 100;
}

window.Harness = {
  async createPlayer(variantJson, baseUrl) {
    const variant = JSON.parse(variantJson);
    const player = createProxyPlayer(variant, baseUrl);
    const id = nextId++;
    players.set(id, player);
    return id;
  },

  async selectVariant(variantsJson) {
    const variants = JSON.parse(variantsJson);
    const selected = await selectProxyVariant(variants);
    return selected ? JSON.stringify(selected) : null;
  },

  disposePlayer(id) {
    // Deliberately left in the registry (not deleted) so a test can still
    // call getFrame()/etc. on the now-disposed player to assert it rejects.
    getPlayer(id).dispose();
  },

  async waitFirstFrame(id) {
    const start = performance.now();
    const frame = await getPlayer(id).firstFrame;
    const elapsedMs = performance.now() - start;
    const size = frameSize(frame);
    return { ...size, kind: frameKind(frame), elapsedMs };
  },

  // Reads bytesLoaded/bytesTotal in the same microtask firstFrame settles
  // in, rather than after a separate round trip, so the numbers reflect
  // exactly how much had downloaded at that moment (no race with network
  // progress happening between two separate page.evaluate() calls).
  async waitFirstFrameAndBytes(id) {
    const player = getPlayer(id);
    await player.firstFrame;
    return { loaded: player.bytesLoaded, total: player.bytesTotal };
  },

  async getFrame(id, index) {
    const start = performance.now();
    const frame = await getPlayer(id).getFrame(index);
    const elapsedMs = performance.now() - start;
    const size = frameSize(frame);
    return { ...size, kind: frameKind(frame), elapsedMs };
  },

  async compareFrameToReference(id, index, referenceUrl, crop) {
    const player = getPlayer(id);
    const frame = await player.getFrame(index);
    const size = frameSize(frame);
    const cropRect = crop ?? { x: 0, y: 0, w: size.width, h: size.height };

    const canvas = new OffscreenCanvas(cropRect.w, cropRect.h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      frame,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      cropRect.w,
      cropRect.h,
    );
    const actual = ctx.getImageData(0, 0, cropRect.w, cropRect.h).data;

    const reference = await loadReferenceBitmap(referenceUrl);
    const refCanvas = new OffscreenCanvas(cropRect.w, cropRect.h);
    const refCtx = refCanvas.getContext('2d');
    refCtx.drawImage(
      reference,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      cropRect.w,
      cropRect.h,
    );
    const expected = refCtx.getImageData(0, 0, cropRect.w, cropRect.h).data;
    reference.close();

    return { meanAbsDiffPct: diffCanvases(actual, expected) };
  },

  getAvailable(id) {
    return getPlayer(id).available;
  },

  getBytes(id) {
    const player = getPlayer(id);
    return { loaded: player.bytesLoaded, total: player.bytesTotal };
  },

  prefetch(id, center, radius) {
    getPlayer(id).prefetch(center, radius);
  },

  // Simulates a 360-degree scrub: walks every frame index once around the
  // ring, calling prefetch() ahead of each getFrame() the way a real
  // pointer-drag handler would, and reports how many of those getFrame()
  // calls were served from cache (decodeToFrame's top-of-function hit)
  // rather than triggering a fresh decode.
  async simulateScrub(id, totalFrames, prefetchRadius) {
    const player = getPlayer(id);
    let hits = 0;
    let misses = 0;
    for (let step = 0; step < totalFrames; step++) {
      const index = step % totalFrames;
      const before = performance.now();
      await player.getFrame(index);
      const elapsed = performance.now() - before;
      // A cache hit resolves near-instantly (sub-millisecond, no decode or
      // network work); anything taking meaningfully longer did real work.
      if (elapsed < 1) hits++;
      else misses++;
      player.prefetch((index + 1) % totalFrames, prefetchRadius);
    }
    return { hits, misses, total: totalFrames };
  },

  resourceUrlsMatching(substring) {
    return performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes(substring));
  },

  async expectGetFrameRejects(id, index) {
    try {
      await getPlayer(id).getFrame(index);
      return false;
    } catch {
      return true;
    }
  },
};
