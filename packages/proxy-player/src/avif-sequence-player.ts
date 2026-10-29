import { resolveUrl, type ProxyVariant } from '@understudy3d/manifest';
import type { FrameImage, ProxyPlayer } from './types.js';
import { createLruCache, type LruCache } from './lru-cache.js';
import { ringWindow } from './gop.js';

const DEFAULT_CACHE_BUDGET = 24;

/**
 * Substitutes the index into the (still relative) pattern *before*
 * resolving against baseUrl — `new URL()` percent-encodes `{` and `}` to
 * `%7B`/`%7D`, so resolving first would leave nothing for `{i}` to match.
 */
function frameUrl(baseUrl: string, pattern: string, index: number): string {
  const relative = pattern.replace('{i}', String(index).padStart(3, '0'));
  return resolveUrl(baseUrl, relative);
}

async function frameExists(baseUrl: string, pattern: string, index: number): Promise<boolean> {
  try {
    const response = await fetch(frameUrl(baseUrl, pattern, index), { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Discovers the sequence length in O(log n) requests: double the probe
 * index until one is missing, then binary-search the exact boundary
 * (~7-8 requests for a 72-frame sequence). The frozen ProxyVariant/
 * createProxyPlayer contract carries no frame count (see
 * docs/change-requests/P4-proxyvariant-frame-count.md) — a video variant
 * self-describes via its MP4 sample table, but a bare AVIF sequence has no
 * equivalent, so this is the local workaround for that gap.
 */
async function discoverFrameCount(baseUrl: string, pattern: string): Promise<number> {
  if (!(await frameExists(baseUrl, pattern, 0))) {
    throw new Error(`AVIF sequence has no frame 0: ${frameUrl(baseUrl, pattern, 0)}`);
  }
  let low = 0;
  let high = 1;
  while (await frameExists(baseUrl, pattern, high)) {
    low = high;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await frameExists(baseUrl, pattern, mid)) low = mid;
    else high = mid;
  }
  return low + 1;
}

/**
 * Milestone D: last-resort fallback, one AVIF still per frame. No GOP
 * structure — any index is independently fetchable — so `available` is the
 * full range as soon as the sequence length is known, and `getFrame` is
 * just fetch + createImageBitmap with an LRU in front of it.
 */
export function createAvifSequenceProxyPlayer(
  variant: ProxyVariant,
  baseUrl: string,
  options: { cacheBudget?: number } = {},
): ProxyPlayer {
  if (variant.kind !== 'image-sequence') {
    throw new Error(
      `createAvifSequenceProxyPlayer requires an image-sequence variant, got "${variant.kind}"`,
    );
  }
  const cacheBudget = options.cacheBudget ?? DEFAULT_CACHE_BUDGET;

  let disposed = false;
  let totalFrames = 0;
  let bytesLoaded = 0;
  let prefetchWindow = new Set<number>();
  const activeTargets = new Set<number>();
  const pendingFetches = new Map<number, Promise<ImageBitmap>>();

  const cache: LruCache<number, ImageBitmap> = createLruCache<number, ImageBitmap>(
    cacheBudget,
    (_key, bitmap) => bitmap.close(),
    (key) => prefetchWindow.has(key) || activeTargets.has(key),
  );

  let availableTo = -1;
  const availableChangeListeners = new Set<() => void>();

  let firstFrameSettled = false;
  let firstFrameResolve!: (frame: FrameImage) => void;
  let firstFrameReject!: (error: Error) => void;
  const firstFrame = new Promise<FrameImage>((resolve, reject) => {
    firstFrameResolve = resolve;
    firstFrameReject = reject;
  });

  function failFirstFrame(error: Error): void {
    if (firstFrameSettled) return;
    firstFrameSettled = true;
    firstFrameReject(error);
  }

  async function fetchFrame(index: number): Promise<ImageBitmap> {
    const response = await fetch(frameUrl(baseUrl, variant.url, index));
    if (!response.ok) {
      throw new Error(`Failed to fetch AVIF frame ${index}: ${response.status}`);
    }
    const blob = await response.blob();
    bytesLoaded += blob.size;
    return createImageBitmap(blob);
  }

  async function getFrame(index: number): Promise<FrameImage> {
    if (disposed) throw new Error('ProxyPlayer disposed');
    if (totalFrames === 0) await ready;
    if (disposed) throw new Error('ProxyPlayer disposed');
    if (!Number.isInteger(index) || index < 0 || index >= totalFrames) {
      throw new Error(`Frame index ${index} out of range [0, ${totalFrames})`);
    }

    const cached = cache.get(index);
    if (cached) return cached;

    const existingFetch = pendingFetches.get(index);
    if (existingFetch) return existingFetch;

    activeTargets.add(index);
    const fetchPromise = fetchFrame(index)
      .then((bitmap) => {
        if (disposed) {
          bitmap.close();
          throw new Error('ProxyPlayer disposed');
        }
        cache.set(index, bitmap);
        if (!firstFrameSettled && index === 0) {
          firstFrameSettled = true;
          firstFrameResolve(bitmap);
        }
        return bitmap;
      })
      .finally(() => {
        activeTargets.delete(index);
        pendingFetches.delete(index);
      });
    pendingFetches.set(index, fetchPromise);
    return fetchPromise;
  }

  function prefetch(centerIndex: number, radius: number): void {
    if (disposed || totalFrames === 0) return;
    if (!Number.isInteger(centerIndex) || centerIndex < 0 || centerIndex >= totalFrames) return;
    const window = ringWindow(centerIndex, radius, totalFrames);
    prefetchWindow = new Set(window);
    for (const index of window) {
      if (!cache.has(index)) {
        void getFrame(index).catch(() => {
          /* best-effort warm; failures surface to explicit getFrame() callers */
        });
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const key of cache.keys()) cache.peek(key)?.close();
    cache.clear();
    prefetchWindow.clear();
    activeTargets.clear();
    pendingFetches.clear();
    availableChangeListeners.clear();
    failFirstFrame(new Error('ProxyPlayer disposed'));
  }

  const ready: Promise<number> = discoverFrameCount(baseUrl, variant.url).then((count) => {
    totalFrames = count;
    availableTo = totalFrames - 1;
    for (const cb of availableChangeListeners) cb();
    void getFrame(0).catch(() => {
      /* failures surface through firstFrame's own rejection */
    });
    return count;
  });
  ready.catch((error: Error) => failFirstFrame(error));

  return {
    firstFrame,
    get available() {
      return { from: 0, to: availableTo };
    },
    onAvailableChange(cb) {
      availableChangeListeners.add(cb);
      return () => availableChangeListeners.delete(cb);
    },
    getFrame,
    prefetch,
    get bytesLoaded() {
      return bytesLoaded;
    },
    get bytesTotal() {
      return variant.bytes;
    },
    dispose,
  };
}
