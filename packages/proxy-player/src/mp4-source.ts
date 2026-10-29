import { createFile, MP4BoxBuffer, type ISOFile, type Sample } from 'mp4box';
import { getSampleEntryDescription } from './mp4-description.js';
import { isAllowedCodecString } from './codec-support.js';

export interface FrameMeta {
  readonly number: number;
  readonly offset: number;
  readonly size: number;
  readonly isSync: boolean;
  readonly cts: number;
  readonly dts: number;
}

export interface Mp4SourceInfo {
  readonly trackId: number;
  readonly codec: string;
  readonly description?: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly totalFrames: number;
  readonly gop: number;
  readonly timescale: number;
}

/**
 * Streams and demuxes one MP4 proxy variant with mp4box.js. A single
 * implementation serves both brief milestones: "whole-file" (A) is simply
 * the case where every chunk arrives before anything is requested;
 * "streaming" (B) is the same code path observed while bytes are still in
 * flight. There is no second code path to keep in sync.
 *
 * Sample *metadata* (offset/size/sync/timing for every frame) is available
 * the moment `moov` is parsed — ISOBMFF's sample tables describe the whole
 * file regardless of how much of `mdat` has downloaded — so `ready`
 * resolves, and the exact GOP is known, long before frame data has
 * streamed in. Sample *data* becomes available progressively as bytes
 * arrive, surfaced via onFrameData / waitForFrameData.
 */
export interface Mp4Source {
  readonly ready: Promise<Mp4SourceInfo>;
  readonly isoFile: ISOFile;
  readonly bytesLoaded: number;
  readonly bytesTotal: number;
  /** Highest frame index N such that frames 0..N all have data in hand. */
  readonly highestContiguousFrame: number;
  getFrameMeta(index: number): FrameMeta | undefined;
  getFrameData(index: number): Uint8Array | undefined;
  /** Resolves once frame `index`'s bytes have arrived (immediately if already present). */
  waitForFrameData(index: number): Promise<Uint8Array>;
  onProgress(cb: () => void): () => void;
  onError(cb: (error: Error) => void): () => void;
  releaseFrameData(index: number): void;
  abort(): void;
}

function inferGop(frames: readonly FrameMeta[]): number {
  const syncNumbers = frames.filter((f) => f.isSync).map((f) => f.number);
  if (syncNumbers.length < 2) return frames.length;
  return (syncNumbers[1] as number) - (syncNumbers[0] as number);
}

export function openMp4Source(url: string): Mp4Source {
  const file = createFile();
  const frameData = new Map<number, Uint8Array>();
  const frameMetaByNumber = new Map<number, FrameMeta>();
  const dataWaiters = new Map<number, Array<{ resolve: (data: Uint8Array) => void; reject: (error: Error) => void }>>();
  let trackId = -1;
  let highestContiguousFrame = -1;
  let bytesLoaded = 0;
  let bytesTotal = 0;
  let aborted = false;
  let abortController: AbortController | undefined;
  let fatalError: Error | undefined;

  const progressListeners = new Set<() => void>();
  const errorListeners = new Set<(error: Error) => void>();

  let resolveReady!: (info: Mp4SourceInfo) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<Mp4SourceInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function emitError(error: Error): void {
    if (fatalError) return;
    fatalError = error;
    for (const cb of errorListeners) cb(error);
    rejectReady(error);
    for (const waiters of dataWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    dataWaiters.clear();
  }

  function resolveWaiters(frameNumber: number, data: Uint8Array): void {
    const waiters = dataWaiters.get(frameNumber);
    if (!waiters) return;
    dataWaiters.delete(frameNumber);
    for (const waiter of waiters) waiter.resolve(data);
  }

  function advanceContiguous(): void {
    while (frameData.has(highestContiguousFrame + 1)) highestContiguousFrame++;
  }

  file.onReady = (info) => {
    const track = info.videoTracks[0];
    if (!track) {
      emitError(new Error('MP4 has no video track'));
      return;
    }
    if (!isAllowedCodecString(track.codec)) {
      emitError(new Error(`Refusing non-AV1/VP9 codec: ${track.codec}`));
      return;
    }
    trackId = track.id;
    const samples = file.getTrackSamplesInfo(trackId);
    const frames: FrameMeta[] = samples.map((s: Sample) => ({
      number: s.number,
      offset: s.offset,
      size: s.size,
      isSync: s.is_sync,
      cts: s.cts,
      dts: s.dts,
    }));
    for (const f of frames) {
      if (f.cts !== f.dts) {
        emitError(
          new Error(
            `Frame ${f.number}: cts (${f.cts}) !== dts (${f.dts}) — this decoder assumes an ` +
              `all-intra-period encode with no B-frames`,
          ),
        );
        return;
      }
      frameMetaByNumber.set(f.number, f);
    }
    const description = getSampleEntryDescription(file, trackId);
    const sourceInfo: Mp4SourceInfo = {
      trackId,
      codec: track.codec,
      ...(description ? { description } : {}),
      width: track.video?.width ?? 0,
      height: track.video?.height ?? 0,
      totalFrames: frames.length,
      gop: inferGop(frames),
      timescale: track.timescale,
    };
    resolveReady(sourceInfo);
    file.setExtractionOptions(trackId, null, { nbSamples: 1 });
    file.start();
  };

  file.onSamples = (_id, _user, samples) => {
    for (const sample of samples) {
      if (!sample.data) continue;
      // mp4box reuses/releases its internal buffers; copy out what we keep.
      const copy = sample.data.slice();
      frameData.set(sample.number, copy);
      resolveWaiters(sample.number, copy);
    }
    advanceContiguous();
    for (const cb of progressListeners) cb();
    if (trackId >= 0) file.releaseUsedSamples(trackId, Math.max(0, highestContiguousFrame));
  };

  file.onError = (moduleName, message) => {
    emitError(new Error(`mp4box error in ${moduleName}: ${message}`));
  };

  async function pump(): Promise<void> {
    abortController = new AbortController();
    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch proxy variant (${response.status}): ${url}`);
      }
      const contentLength = response.headers.get('Content-Length');
      if (contentLength) bytesTotal = Number(contentLength);

      const reader = response.body.getReader();
      let fileStart = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (aborted) return;
        const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        const chunk = MP4BoxBuffer.fromArrayBuffer(ab, fileStart);
        fileStart += value.byteLength;
        bytesLoaded += value.byteLength;
        file.appendBuffer(chunk);
        for (const cb of progressListeners) cb();
      }
      if (!aborted) {
        bytesTotal = bytesTotal || bytesLoaded;
        file.flush();
        for (const cb of progressListeners) cb();
      }
    } catch (error) {
      if (!aborted) emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  void pump();

  return {
    ready,
    isoFile: file,
    get bytesLoaded() {
      return bytesLoaded;
    },
    get bytesTotal() {
      return bytesTotal;
    },
    get highestContiguousFrame() {
      return highestContiguousFrame;
    },
    getFrameMeta(index) {
      return frameMetaByNumber.get(index);
    },
    getFrameData(index) {
      return frameData.get(index);
    },
    waitForFrameData(index) {
      const existing = frameData.get(index);
      if (existing) return Promise.resolve(existing);
      if (fatalError) return Promise.reject(fatalError);
      return new Promise((resolve, reject) => {
        const list = dataWaiters.get(index) ?? [];
        list.push({ resolve, reject });
        dataWaiters.set(index, list);
      });
    },
    onProgress(cb) {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    onError(cb) {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },
    releaseFrameData(index) {
      frameData.delete(index);
    },
    abort() {
      if (aborted) return;
      aborted = true;
      abortController?.abort();
      const abortError = new Error('Mp4Source disposed');
      rejectReady(abortError);
      for (const waiters of dataWaiters.values()) {
        for (const waiter of waiters) waiter.reject(abortError);
      }
      progressListeners.clear();
      errorListeners.clear();
      dataWaiters.clear();
      frameData.clear();
    },
  };
}

export interface ContainerMetadata extends Mp4SourceInfo {
  readonly frames: readonly FrameMeta[];
}

/** Enough for ftyp+moov on a +faststart proxy file without fetching the whole video. */
const METADATA_PROBE_BYTES = 262_144;

/**
 * Reads only enough of the file to parse `moov` and returns full per-frame
 * timing — used by the <video> fallback (Milestone C), which needs exact
 * seek targets but has no reason to decode via WebCodecs. ISOBMFF's sample
 * tables describe every frame's offset/size/timing from `moov` alone, so
 * this never needs to fetch sample data.
 */
export async function probeContainerMetadata(url: string): Promise<ContainerMetadata> {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${METADATA_PROBE_BYTES - 1}` },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Container metadata probe failed (${response.status}): ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return new Promise<ContainerMetadata>((resolve, reject) => {
    const file = createFile();
    file.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track) {
        reject(new Error('MP4 has no video track'));
        return;
      }
      if (!isAllowedCodecString(track.codec)) {
        reject(new Error(`Refusing non-AV1/VP9 codec: ${track.codec}`));
        return;
      }
      const samples = file.getTrackSamplesInfo(track.id);
      const frames: FrameMeta[] = samples.map((s: Sample) => ({
        number: s.number,
        offset: s.offset,
        size: s.size,
        isSync: s.is_sync,
        cts: s.cts,
        dts: s.dts,
      }));
      const description = getSampleEntryDescription(file, track.id);
      resolve({
        trackId: track.id,
        codec: track.codec,
        ...(description ? { description } : {}),
        width: track.video?.width ?? 0,
        height: track.video?.height ?? 0,
        totalFrames: frames.length,
        gop: inferGop(frames),
        timescale: track.timescale,
        frames,
      });
    };
    file.onError = (moduleName, message) => {
      reject(new Error(`mp4box error in ${moduleName}: ${message}`));
    };
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0));
    file.flush();
  });
}
