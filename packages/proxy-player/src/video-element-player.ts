import type { FrameImage, ProxyPlayer } from './types.js';
import { probeContainerMetadata } from './mp4-source.js';

interface Waiter {
  resolve: (frame: FrameImage) => void;
  reject: (error: Error) => void;
}

/**
 * Milestone C. No WebCodecs: decode through a hidden <video> element and
 * `currentTime` seeks. Exact per-frame seek targets come from parsing just
 * the container's moov box (probeContainerMetadata) rather than an assumed
 * fps — this is a pure demux read, independent of whether the browser can
 * actually decode the codec via WebCodecs, so it works precisely in the
 * one scenario this player exists for.
 */
export function createVideoElementProxyPlayer(url: string): ProxyPlayer {
  if (typeof document === 'undefined') {
    throw new Error('createVideoElementProxyPlayer requires a DOM (document is undefined)');
  }

  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;
  video.src = url;

  let disposed = false;
  let totalFrames = 0;
  let frameSeconds: number[] = [];
  let bytesTotalEstimate = 0;

  let waiters: Waiter[] = [];
  let latestRequestedIndex: number | null = null;
  let seekInFlight = false;

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

  const metadataReady = probeContainerMetadata(url)
    .then((meta) => {
      totalFrames = meta.totalFrames;
      const first = meta.frames[0];
      const second = meta.frames[1];
      const ticksPerFrame = first && second ? second.cts - first.cts : meta.timescale;
      frameSeconds = meta.frames.map((f) => (f.cts + ticksPerFrame / 2) / meta.timescale);
      bytesTotalEstimate = meta.frames.reduce((sum, f) => sum + f.size, 0);
      availableTo = totalFrames - 1;
      for (const cb of availableChangeListeners) cb();
      // firstFrame is a standalone property of the API, not contingent on
      // the consumer ever calling getFrame(0) — prime the seek ourselves.
      void getFrame(0).catch(() => {
        /* failures surface through firstFrame's own rejection */
      });
      return meta;
    })
    .catch((error: Error) => {
      failFirstFrame(error);
      throw error;
    });

  function waitForSeekSettle(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let rvfcHandle: number | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', onSeeked);
        if (rvfcHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(rvfcHandle);
        }
        resolve();
      };
      const onSeeked = (): void => finish();
      if (typeof video.requestVideoFrameCallback === 'function') {
        rvfcHandle = video.requestVideoFrameCallback(() => finish());
      }
      video.addEventListener('seeked', onSeeked, { once: true });
    });
  }

  async function runSeekLoop(): Promise<void> {
    seekInFlight = true;
    try {
      for (;;) {
        const index = latestRequestedIndex;
        if (index === null) return;
        latestRequestedIndex = null;
        video.currentTime = frameSeconds[index] ?? 0;
        await waitForSeekSettle();
        if (disposed) return;
        // A newer request arrived while this seek was in flight — chase it
        // instead of resolving stale waiters with a frame they didn't ask for.
        if (latestRequestedIndex !== null) continue;
        const settled = waiters;
        waiters = [];
        for (const waiter of settled) waiter.resolve(video);
        if (!firstFrameSettled && index === 0) {
          firstFrameSettled = true;
          firstFrameResolve(video);
        }
        return;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const settled = waiters;
      waiters = [];
      for (const waiter of settled) waiter.reject(err);
      failFirstFrame(err);
    } finally {
      seekInFlight = false;
    }
  }

  async function getFrame(index: number): Promise<FrameImage> {
    if (disposed) throw new Error('ProxyPlayer disposed');
    await metadataReady;
    if (disposed) throw new Error('ProxyPlayer disposed');
    if (!Number.isInteger(index) || index < 0 || index >= totalFrames) {
      throw new Error(`Frame index ${index} out of range [0, ${totalFrames})`);
    }
    return new Promise<FrameImage>((resolve, reject) => {
      waiters.push({ resolve, reject });
      latestRequestedIndex = index;
      if (!seekInFlight) void runSeekLoop();
    });
  }

  function prefetch(): void {
    // The native <video> element manages its own network buffering ahead
    // of the playhead; there is no separate decode cache to warm here.
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    video.pause();
    video.removeAttribute('src');
    video.load();
    const error = new Error('ProxyPlayer disposed');
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter.reject(error);
    failFirstFrame(error);
    availableChangeListeners.clear();
  }

  metadataReady.catch(() => {
    /* failure already surfaced through firstFrame */
  });

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
      if (!video.duration || Number.isNaN(video.duration) || video.buffered.length === 0) return 0;
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      return Math.round((bufferedEnd / video.duration) * bytesTotalEstimate);
    },
    get bytesTotal() {
      return bytesTotalEstimate;
    },
    dispose,
  };
}
