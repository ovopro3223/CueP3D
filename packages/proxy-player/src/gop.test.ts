import { describe, expect, it } from 'vitest';
import {
  decodeRangeForFrame,
  keyframeAtOrBefore,
  lastCompleteGopEnd,
  mergeDecodeRanges,
  ringWindow,
} from './gop.js';

describe('keyframeAtOrBefore', () => {
  it.each([
    [0, 0],
    [7, 0],
    [8, 8],
    [13, 8],
    [63, 56],
    [64, 64],
    [71, 64],
  ])('gop=8: keyframeAtOrBefore(%i) === %i', (index, expected) => {
    expect(keyframeAtOrBefore(index, 8)).toBe(expected);
  });

  it('rejects a non-positive gop', () => {
    expect(() => keyframeAtOrBefore(5, 0)).toThrow();
  });
});

describe('decodeRangeForFrame', () => {
  it('getFrame(13) with gop=8 decodes exactly frames 8..13', () => {
    expect(decodeRangeForFrame(13, 8)).toEqual({ from: 8, to: 13 });
  });

  it('a keyframe itself is a single-frame range', () => {
    expect(decodeRangeForFrame(16, 8)).toEqual({ from: 16, to: 16 });
  });
});

describe('ringWindow', () => {
  it('a 72-frame ring: window(70, 3) wraps past the last frame to 0 and 1', () => {
    const result = ringWindow(70, 3, 72);
    expect(new Set(result)).toEqual(new Set([67, 68, 69, 70, 71, 0, 1]));
    expect(result).toHaveLength(7);
  });

  it('orders nearest-to-center first', () => {
    expect(ringWindow(10, 2, 72)).toEqual([10, 9, 11, 8, 12]);
  });

  it('wraps past 0 going backward', () => {
    const result = ringWindow(1, 2, 72);
    expect(new Set(result)).toEqual(new Set([71, 0, 1, 2, 3]));
  });

  it('de-duplicates when radius covers the whole ring', () => {
    const result = ringWindow(0, 100, 5);
    expect(new Set(result)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(result).toHaveLength(5);
  });

  it('returns an empty array for a zero-length ring', () => {
    expect(ringWindow(0, 3, 0)).toEqual([]);
  });
});

describe('mergeDecodeRanges', () => {
  it('merges overlapping GOP ranges from a prefetch window into runs', () => {
    // frames 67,68,69,70,71,0,1 at gop=8, totalFrames=72 (keyframes at
    // 0,8,...,64): 67..71 need keyframe 64; 0 and 1 need keyframe 0.
    const merged = mergeDecodeRanges([67, 68, 69, 70, 71, 0, 1], 8);
    expect(merged).toEqual([
      { from: 0, to: 1 },
      { from: 64, to: 71 },
    ]);
  });

  it('merges adjacent single-GOP requests into one run', () => {
    const merged = mergeDecodeRanges([13, 14], 8);
    expect(merged).toEqual([{ from: 8, to: 14 }]);
  });
});

describe('lastCompleteGopEnd', () => {
  it('is -1 until the first GOP is fully received', () => {
    expect(lastCompleteGopEnd(6, 8)).toBe(-1);
  });

  it('advances exactly on GOP boundaries', () => {
    expect(lastCompleteGopEnd(7, 8)).toBe(7);
    expect(lastCompleteGopEnd(12, 8)).toBe(7);
    expect(lastCompleteGopEnd(15, 8)).toBe(15);
  });
});
