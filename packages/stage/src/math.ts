/**
 * Camera and frame-index math shared by the build-time proxy renderer (P2)
 * and the live viewer (P6). docs/01-design.md §5.1 is the source of truth —
 * keep this file in sync with it; both sides must compute identical values
 * for the handoff to be invisible.
 */

const TWO_PI = Math.PI * 2;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** d = 1.15 · radius / sin(fov/2), vertical fov. */
export function fitDistance(radius: number, fovDeg: number): number {
  const halfFovRad = degToRad(fovDeg) / 2;
  return (1.15 * radius) / Math.sin(halfFovRad);
}

/**
 * p = t + d·(sinθ·cosφ, sinφ, cosθ·cosφ). θ=0 → +Z; θ increases toward +X.
 * Equivalent to three.js Spherical with phi = π/2 − elevationRad.
 */
export function cameraPositionForView(
  azimuthRad: number,
  elevationRad: number,
  distance: number,
  target: readonly [number, number, number],
): [number, number, number] {
  const [tx, ty, tz] = target;
  return [
    tx + distance * Math.sin(azimuthRad) * Math.cos(elevationRad),
    ty + distance * Math.sin(elevationRad),
    tz + distance * Math.cos(azimuthRad) * Math.cos(elevationRad),
  ];
}

/** Frame index = round(((θ − azimuthStart) mod 2π) / (2π / frames)) mod frames. */
export function frameIndexForAzimuth(
  azimuthRad: number,
  frames: number,
  azimuthStartRad: number,
): number {
  const step = TWO_PI / frames;
  const delta = normalizeAngle(azimuthRad - azimuthStartRad);
  return Math.round(delta / step) % frames;
}

/** Inverse of frameIndexForAzimuth: θ_i = azimuthStart + i · 2π/frames, normalized to [0, 2π). */
export function azimuthForFrameIndex(
  index: number,
  frames: number,
  azimuthStartRad: number,
): number {
  const step = TWO_PI / frames;
  return normalizeAngle(azimuthStartRad + index * step);
}
