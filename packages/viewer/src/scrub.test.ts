import { describe, expect, it } from 'vitest';
import {
  azimuthDeltaForPointerDelta,
  dragVelocityPxPerMs,
  FAST_DRAG_THRESHOLD_PX_PER_MS,
  isFastDrag,
} from './scrub.js';

describe('azimuthDeltaForPointerDelta', () => {
  it('a full canvas-height drag is one full revolution', () => {
    expect(azimuthDeltaForPointerDelta(600, 600)).toBeCloseTo(-2 * Math.PI, 10);
  });

  it('dragging right (positive Δx) decreases θ', () => {
    expect(azimuthDeltaForPointerDelta(100, 400)).toBeLessThan(0);
  });

  it('dragging left (negative Δx) increases θ', () => {
    expect(azimuthDeltaForPointerDelta(-100, 400)).toBeGreaterThan(0);
  });

  it('zero delta is a no-op', () => {
    // -0 is a correct, equivalent result of -(2π·0/h); toBe(0) uses
    // Object.is, which (correctly) distinguishes -0 from +0.
    expect(azimuthDeltaForPointerDelta(0, 400)).toBe(-0);
  });

  it('is linear in Δx', () => {
    const half = azimuthDeltaForPointerDelta(50, 400);
    const full = azimuthDeltaForPointerDelta(100, 400);
    expect(full).toBeCloseTo(half * 2, 10);
  });

  it('degenerate canvas height does not divide by zero', () => {
    expect(azimuthDeltaForPointerDelta(100, 0)).toBe(0);
  });
});

describe('dragVelocityPxPerMs', () => {
  it('needs at least two samples', () => {
    expect(dragVelocityPxPerMs([])).toBe(0);
    expect(dragVelocityPxPerMs([{ tMs: 0, xPx: 0 }])).toBe(0);
  });

  it('computes px/ms between the last two samples only', () => {
    const samples = [
      { tMs: 0, xPx: 0 },
      { tMs: 100, xPx: 1000 }, // stale fast segment
      { tMs: 150, xPx: 1010 }, // recent slow segment: 10px / 50ms = 0.2
    ];
    expect(dragVelocityPxPerMs(samples)).toBeCloseTo(0.2, 10);
  });

  it('is magnitude, not signed', () => {
    const samples = [
      { tMs: 0, xPx: 100 },
      { tMs: 100, xPx: 0 },
    ];
    expect(dragVelocityPxPerMs(samples)).toBeCloseTo(1, 10);
  });

  it('non-advancing timestamps do not divide by zero or go negative', () => {
    const samples = [
      { tMs: 100, xPx: 0 },
      { tMs: 100, xPx: 50 },
    ];
    expect(dragVelocityPxPerMs(samples)).toBe(0);
  });
});

describe('isFastDrag', () => {
  it('below threshold is not fast', () => {
    const samples = [
      { tMs: 0, xPx: 0 },
      { tMs: 100, xPx: 10 }, // 0.1 px/ms
    ];
    expect(isFastDrag(samples)).toBe(false);
  });

  it('above threshold is fast', () => {
    const samples = [
      { tMs: 0, xPx: 0 },
      { tMs: 100, xPx: 50 }, // 0.5 px/ms
    ];
    expect(isFastDrag(samples)).toBe(true);
  });

  it('exactly at threshold is not fast (strict greater-than)', () => {
    const samples = [
      { tMs: 0, xPx: 0 },
      { tMs: 1000, xPx: FAST_DRAG_THRESHOLD_PX_PER_MS * 1000 },
    ];
    expect(isFastDrag(samples)).toBe(false);
  });

  it('accepts a custom threshold', () => {
    const samples = [
      { tMs: 0, xPx: 0 },
      { tMs: 100, xPx: 10 }, // 0.1 px/ms
    ];
    expect(isFastDrag(samples, 0.05)).toBe(true);
  });
});
