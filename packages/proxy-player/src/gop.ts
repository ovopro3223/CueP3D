/**
 * Pure GOP and ring-index math shared by every player implementation.
 * No DOM, no I/O — kept separate so it is cheap to reason about and to test
 * (Vitest, Node) independently of decoders.
 */

export interface FrameRange {
  readonly from: number;
  readonly to: number;
}

/** The nearest keyframe at or before `index`, given a fixed keyframe interval. */
export function keyframeAtOrBefore(index: number, gop: number): number {
  if (gop <= 0) throw new Error(`gop must be positive, got ${gop}`);
  if (index < 0) throw new Error(`index must be non-negative, got ${index}`);
  return index - (index % gop);
}

/**
 * The inclusive decode range needed to produce `index`: from its GOP's
 * keyframe forward to `index` itself. All-intra-period encodes (D-009; no
 * B-frames) make "decode forward from the keyframe" sufficient — decode
 * order equals presentation order.
 */
export function decodeRangeForFrame(index: number, gop: number): FrameRange {
  return { from: keyframeAtOrBefore(index, gop), to: index };
}

function wrapIndex(index: number, totalFrames: number): number {
  const wrapped = index % totalFrames;
  return wrapped < 0 ? wrapped + totalFrames : wrapped;
}

/**
 * Frame indices within `radius` of `centerIndex`, wrapping around the ring
 * (the proxy is a 360° orbit loop, so scrubbing past the last frame
 * continues at frame 0). Ordered by distance from the center, nearest
 * first, so callers that decode in order warm the frames most likely to be
 * requested next before farther ones.
 */
export function ringWindow(centerIndex: number, radius: number, totalFrames: number): number[] {
  if (totalFrames <= 0) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  const clampedRadius = Math.min(radius, Math.floor((totalFrames - 1) / 2));
  for (let d = 0; d <= clampedRadius; d++) {
    for (const candidate of d === 0 ? [centerIndex] : [centerIndex - d, centerIndex + d]) {
      const wrapped = wrapIndex(candidate, totalFrames);
      if (!seen.has(wrapped)) {
        seen.add(wrapped);
        result.push(wrapped);
      }
    }
  }
  return result;
}

/**
 * The GOP-aligned decode ranges needed to cover every frame in `indices`,
 * merged so overlapping/adjacent ranges decode once. Used by prefetch() to
 * schedule the minimum number of decode runs for a window of frames.
 */
export function mergeDecodeRanges(indices: readonly number[], gop: number): FrameRange[] {
  const ranges = indices
    .map((i) => decodeRangeForFrame(i, gop))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: FrameRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to + 1) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, range.to) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** The last fully-received GOP boundary at or before `highestContiguousFrame`. */
export function lastCompleteGopEnd(highestContiguousFrame: number, gop: number): number {
  if (highestContiguousFrame < gop - 1) return -1;
  return Math.floor((highestContiguousFrame + 1) / gop) * gop - 1;
}
