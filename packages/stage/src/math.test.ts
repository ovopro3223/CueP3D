import { describe, expect, it } from 'vitest';
import {
  azimuthForFrameIndex,
  cameraPositionForView,
  fitDistance,
  frameIndexForAzimuth,
} from './math.js';

describe('azimuth <-> frame index round trip', () => {
  it.each([72, 36])('round-trips every frame for frames=%i', (frames) => {
    for (let i = 0; i < frames; i++) {
      const azimuth = azimuthForFrameIndex(i, frames, 0);
      expect(frameIndexForAzimuth(azimuth, frames, 0)).toBe(i);
    }
  });

  it('round-trips with a non-zero azimuth start', () => {
    const frames = 72;
    const start = Math.PI / 6;
    for (let i = 0; i < frames; i++) {
      const azimuth = azimuthForFrameIndex(i, frames, start);
      expect(frameIndexForAzimuth(azimuth, frames, start)).toBe(i);
    }
  });
});

describe('cameraPositionForView', () => {
  const target: [number, number, number] = [0, 0, 0];

  it('places the camera on +Z at azimuth 0, elevation 0 (front view)', () => {
    const [x, y, z] = cameraPositionForView(0, 0, 1, target);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(1, 10);
  });

  it('places the camera on +X at azimuth pi/2, elevation 0', () => {
    const [x, y, z] = cameraPositionForView(Math.PI / 2, 0, 1, target);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('raises the camera on +Y as elevation increases', () => {
    const [, y] = cameraPositionForView(0, Math.PI / 4, 1, target);
    expect(y).toBeCloseTo(Math.sin(Math.PI / 4), 10);
  });

  it('offsets around a non-origin target', () => {
    const [x, y, z] = cameraPositionForView(0, 0, 1, [1, 2, 3]);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(2, 10);
    expect(z).toBeCloseTo(4, 10);
  });
});

describe('fitDistance', () => {
  it('grows with radius and shrinks with a wider fov', () => {
    const d1 = fitDistance(1, 35);
    const d2 = fitDistance(2, 35);
    const d3 = fitDistance(1, 70);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeLessThan(d1);
  });

  it('matches the documented formula', () => {
    const radius = 1.5;
    const fovDeg = 40;
    const expected = (1.15 * radius) / Math.sin((fovDeg * Math.PI) / 180 / 2);
    expect(fitDistance(radius, fovDeg)).toBeCloseTo(expected, 10);
  });
});
