import { resolveUrl, type ProxyVariant } from '@cuep3d/manifest';
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
  const totalFrames = variant.frames;

  let disposed = false;
  let bytesLoaded = 0;
  let prefetchWindow = new Set<number>();
  const activeTargets = new Set<number>();
  const pendingFetches = new Map<number, Promise<ImageBitmap>>();

  const cache: LruCache<number, ImageBitmap> = createLruCache<number, ImageBitmap>(
    cacheBudget,
    (_key, bitmap) => bitmap.close(),
    (key) => prefetchWindow.has(key) || activeTargets.has(key),
  );

  // Unlike the video players, the frame count is known synchronously (it's
  // on the variant), so the full range is available immediately — no GOP
  // structure means any index is independently fetchable from the start.
  const availableTo = totalFrames - 1;
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
    if (disposed) return;
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

  void getFrame(0).catch((error: Error) => failFirstFrame(error));

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
