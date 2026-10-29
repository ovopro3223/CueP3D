import type { FrameImage, ProxyPlayer } from './types.js';
import { createLruCache, type LruCache } from './lru-cache.js';
import { decodeRangeForFrame, keyframeAtOrBefore, ringWindow } from './gop.js';
import { openMp4Source, type Mp4SourceInfo } from './mp4-source.js';
import { isVideoDecoderConfigSupported } from './codec-support.js';

const DEFAULT_CACHE_BUDGET = 24;

function ctsToMicroseconds(cts: number, timescale: number): number {
  return Math.round((cts / timescale) * 1_000_000);
}

/**
 * Milestones A+B (whole-file and streaming): one implementation, since
 * "whole-file" is simply the case where every chunk has already arrived by
 * the time a frame is requested — there's no reason to maintain a second
 * code path that only differs in how patient it needs to be.
 */
export function createWebCodecsProxyPlayer(
  url: string,
  options: { cacheBudget?: number } = {},
): ProxyPlayer {
  const cacheBudget = options.cacheBudget ?? DEFAULT_CACHE_BUDGET;
  const source = openMp4Source(url);

  let sourceInfo: Mp4SourceInfo | undefined;
  let gop = 1;
  let totalFrames = 0;
  let disposed = false;
  let decoder: VideoDecoder | undefined;
  let decodeQueueTail: Promise<void> = Promise.resolve();
  let lastDecodedFrame = -1;
  const pendingTargets: number[] = [];

  let prefetchWindow = new Set<number>();
  const activeTargets = new Set<number>();

  const availableChangeListeners = new Set<() => void>();
  let availableTo = -1;

  function setAvailable(to: number): void {
    if (to <= availableTo) return;
    availableTo = to;
    for (const cb of availableChangeListeners) cb();
  }

  const cache: LruCache<number, VideoFrame> = createLruCache<number, VideoFrame>(
    cacheBudget,
    (_key, frame) => frame.close(),
    (key) => prefetchWindow.has(key) || activeTargets.has(key),
  );

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

  const unsubscribeProgress = source.onProgress(() => {
    if (!sourceInfo) return;
    // Publicly advertise availability at GOP granularity (brief: "available.to
    // advances with the last fully received GOP"); getFrame() itself may still
    // decode a frame whose bytes arrived but whose GOP isn't fully in yet.
    const highest = source.highestContiguousFrame;
    if (highest < gop - 1) return;
    const completeGopEnd = Math.floor((highest + 1) / gop) * gop - 1;
    setAvailable(Math.min(completeGopEnd, totalFrames - 1));
  });
  const unsubscribeSourceError = source.onError((error) => failFirstFrame(error));

  const ready: Promise<Mp4SourceInfo> = source.ready.then(async (resolvedInfo) => {
    sourceInfo = resolvedInfo;
    gop = resolvedInfo.gop;
    totalFrames = resolvedInfo.totalFrames;

    const supported = await isVideoDecoderConfigSupported(
      resolvedInfo.codec,
      resolvedInfo.width,
      resolvedInfo.height,
      resolvedInfo.description,
    );
    if (!supported) {
      throw new Error(
        `VideoDecoder cannot configure codec "${resolvedInfo.codec}" — selectProxyVariant ` +
          `should not have chosen this variant for the WebCodecs path`,
      );
    }

    decoder = new VideoDecoder({
      output: handleDecoderOutput,
      error: (error) => failFirstFrame(error instanceof Error ? error : new Error(String(error))),
    });
    decoder.configure(
      resolvedInfo.description
        ? {
            codec: resolvedInfo.codec,
            codedWidth: resolvedInfo.width,
            codedHeight: resolvedInfo.height,
            description: resolvedInfo.description,
          }
        : {
            codec: resolvedInfo.codec,
            codedWidth: resolvedInfo.width,
            codedHeight: resolvedInfo.height,
          },
    );
    // firstFrame is a standalone property of the API, not contingent on the
    // consumer ever calling getFrame(0) — prime the decode ourselves.
    void getFrame(0).catch(() => {
      /* failures surface through firstFrame's own rejection, via failFirstFrame */
    });
    return resolvedInfo;
  });
  ready.catch((error: Error) => failFirstFrame(error));

  function handleDecoderOutput(frame: VideoFrame): void {
    const frameNumber = pendingTargets.shift();
    if (frameNumber === undefined) {
      frame.close();
      return;
    }
    lastDecodedFrame = frameNumber;
    const keep = activeTargets.has(frameNumber) || prefetchWindow.has(frameNumber);
    if (keep) {
      cache.set(frameNumber, frame);
    } else {
      // An intermediate frame decoded only to reach a later target in the
      // same GOP, and not currently of interest on its own — discard
      // rather than pollute the cache (brief: "close intermediate frames
      // unless they are within the prefetch window").
      frame.close();
    }
    if (!firstFrameSettled && frameNumber === 0 && keep) {
      firstFrameSettled = true;
      firstFrameResolve(frame);
    }
  }

  async function decodeToFrame(index: number): Promise<VideoFrame> {
    const alreadyCached = cache.get(index);
    if (alreadyCached) return alreadyCached;
    if (!sourceInfo || !decoder) throw new Error('Decoder not configured');

    const sameGop =
      lastDecodedFrame >= 0 &&
      keyframeAtOrBefore(index, gop) === keyframeAtOrBefore(lastDecodedFrame, gop);
    const canContinue = sameGop && index === lastDecodedFrame + 1;
    const range = canContinue ? { from: index, to: index } : decodeRangeForFrame(index, gop);

    for (let i = range.from; i <= range.to; i++) {
      const data = await source.waitForFrameData(i);
      const meta = source.getFrameMeta(i);
      if (!meta) throw new Error(`No sample metadata for frame ${i}`);
      const chunk = new EncodedVideoChunk({
        type: meta.isSync ? 'key' : 'delta',
        timestamp: ctsToMicroseconds(meta.cts, sourceInfo.timescale),
        data,
      });
      pendingTargets.push(i);
      decoder.decode(chunk);
    }
    await decoder.flush();

    const result = cache.get(index);
    if (!result) throw new Error(`Decode completed but frame ${index} is missing from cache`);
    return result;
  }

  function scheduleDecode(index: number): Promise<VideoFrame> {
    const job = decodeQueueTail.then(() => decodeToFrame(index));
    decodeQueueTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  async function getFrame(index: number): Promise<FrameImage> {
    if (disposed) throw new Error('ProxyPlayer disposed');
    if (!sourceInfo) await ready;
    if (disposed) throw new Error('ProxyPlayer disposed');
    if (!Number.isInteger(index) || index < 0 || index >= totalFrames) {
      throw new Error(`Frame index ${index} out of range [0, ${totalFrames})`);
    }
    const cached = cache.get(index);
    if (cached) return cached;

    activeTargets.add(index);
    try {
      return await scheduleDecode(index);
    } finally {
      activeTargets.delete(index);
    }
  }

  function prefetch(centerIndex: number, radius: number): void {
    if (disposed || !sourceInfo) return;
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
    unsubscribeProgress();
    unsubscribeSourceError();
    source.abort();
    if (decoder && decoder.state !== 'closed') decoder.close();
    for (const key of cache.keys()) cache.peek(key)?.close();
    cache.clear();
    prefetchWindow.clear();
    activeTargets.clear();
    availableChangeListeners.clear();
    failFirstFrame(new Error('ProxyPlayer disposed'));
  }

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
      return source.bytesLoaded;
    },
    get bytesTotal() {
      return source.bytesTotal;
    },
    dispose,
  };
}
