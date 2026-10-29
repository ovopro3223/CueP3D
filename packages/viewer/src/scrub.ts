/**
 * Pure pointer-drag math (docs/01-design.md §5.1): the horizontal-delta to
 * azimuth-delta mapping, and a small velocity tracker used by the handoff
 * rule (§6) to tell a slow scrub from a fast fling.
 */

const TWO_PI = Math.PI * 2;

/**
 * θ −= 2π·Δx/h — a horizontal drag of a full canvas-height in pixels is one
 * full revolution, matching three.js OrbitControls' `rotateSpeed = 1` feel
 * (§5.1) so scrubbing the proxy and orbiting the live model feel identical.
 */
export function azimuthDeltaForPointerDelta(deltaXPx: number, canvasHeightPx: number): number {
  if (canvasHeightPx <= 0) return 0;
  return -(TWO_PI * deltaXPx) / canvasHeightPx;
}

export interface DragSample {
  tMs: number;
  xPx: number;
}

/**
 * Velocity between the two most recent samples. Two samples (not a longer
 * window) deliberately: the handoff wait (see create-viewer.ts) re-checks
 * on every pointermove, so "is the drag fast right now" should react to the
 * very latest motion, not be smoothed into staleness by averaging over a
 * fling that already ended.
 */
export function dragVelocityPxPerMs(samples: readonly DragSample[]): number {
  if (samples.length < 2) return 0;
  const a = samples[samples.length - 2]!;
  const b = samples[samples.length - 1]!;
  const dt = b.tMs - a.tMs;
  if (dt <= 0) return 0;
  return Math.abs(b.xPx - a.xPx) / dt;
}

/**
 * 0.3 px/ms (300 px/s) — chosen as a conservative "this is a fling, not a
 * careful look-around" cutoff: a deliberate, examine-the-object drag on a
 * typical 300-600px-tall canvas rarely exceeds ~150 px/s, while an iOS-style
 * flick commonly starts above 500 px/s. Sitting between the two gives the
 * handoff rule room to wait out a genuine fling without ever waiting on an
 * ordinary slow scrub that just happens to still be in contact.
 */
export const FAST_DRAG_THRESHOLD_PX_PER_MS = 0.3;

export function isFastDrag(
  samples: readonly DragSample[],
  thresholdPxPerMs: number = FAST_DRAG_THRESHOLD_PX_PER_MS,
): boolean {
  return dragVelocityPxPerMs(samples) > thresholdPxPerMs;
}
