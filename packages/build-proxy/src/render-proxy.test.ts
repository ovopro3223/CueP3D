import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';
import { azimuthForFrameIndex, degToRad } from '@cuep3d/stage';
import type { StageParams } from '@cuep3d/manifest';
import { renderProxyFrames, type RenderProxyFramesOptions } from './render-proxy.js';
import { decodePngStats } from './test-support/decode-png.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const AVOCADO_GLB = path.join(REPO_ROOT, 'samples', 'Avocado.glb');

// Avocado.glb's own mesh bounds (accessor min/max of its POSITION attribute),
// computed once offline. P1 (build-geometry, not present in this worktree —
// see docs/reports/P2-report.md) normally supplies `bounds` after centering
// the model at the origin; this raw sample isn't centered, so `target` below
// points at its real centre instead of [0,0,0].
const AVOCADO_BOUNDS = { center: [0, 0.0314, 0] as [number, number, number], radius: 0.0404 };

const STAGE_BASE: Omit<StageParams, 'distance'> = {
  fovDeg: 35,
  target: AVOCADO_BOUNDS.center,
  environment: 'studio-neutral',
  exposure: 1,
  toneMapping: 'aces',
};

const BACKGROUND = '#ffffff';

function baseOptions(
  outDir: string,
  overrides: Partial<RenderProxyFramesOptions> = {},
): RenderProxyFramesOptions {
  return {
    modelUrlOrPath: AVOCADO_GLB,
    outDir,
    size: 256,
    frames: 8,
    ringsDeg: [20],
    azimuthStartDeg: 0,
    stage: STAGE_BASE,
    background: BACKGROUND,
    bounds: AVOCADO_BOUNDS,
    ...overrides,
  };
}

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'cuep3d-build-proxy-'));
}

describe('renderProxyFrames', () => {
  let outDir: string;
  let result: Awaited<ReturnType<typeof renderProxyFrames>>;
  let decodeBrowser: Browser;

  beforeAll(async () => {
    outDir = await makeTmpDir();
    result = await renderProxyFrames(baseOptions(outDir));
    decodeBrowser = await puppeteer.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    });
  }, 120_000);

  afterAll(async () => {
    await decodeBrowser.close();
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes one PNG per frame, each exactly size x size', async () => {
    for (let i = 0; i < 8; i++) {
      const fileName = String(i).padStart(3, '0') + '.png';
      const png = await readFile(path.join(result.framesDir, fileName));
      const stats = await decodePngStats(decodeBrowser, png);
      expect(stats.width).toBe(256);
      expect(stats.height).toBe(256);
    }
  }, 60_000);

  it('rotates the object between frame 0 and frame 4 (mean colour differs)', async () => {
    const frame0 = await readFile(path.join(result.framesDir, '000.png'));
    const frame4 = await readFile(path.join(result.framesDir, '004.png'));
    const stats0 = await decodePngStats(decodeBrowser, frame0);
    const stats4 = await decodePngStats(decodeBrowser, frame4);

    const meanDelta =
      Math.abs(stats0.mean[0] - stats4.mean[0]) +
      Math.abs(stats0.mean[1] - stats4.mean[1]) +
      Math.abs(stats0.mean[2] - stats4.mean[2]);
    expect(meanDelta).toBeGreaterThan(0.5);
  }, 30_000);

  it('bakes an opaque background colour into the corners', async () => {
    const frame0 = await readFile(path.join(result.framesDir, '000.png'));
    const stats = await decodePngStats(decodeBrowser, frame0);
    for (const corner of Object.values(stats.corners)) {
      expect(corner[0]).toBeGreaterThanOrEqual(252);
      expect(corner[1]).toBeGreaterThanOrEqual(252);
      expect(corner[2]).toBeGreaterThanOrEqual(252);
      expect(corner[3]).toBe(255);
    }
  }, 30_000);

  it('writes a camera.json whose azimuths round-trip through stage math', async () => {
    const cameraJson = JSON.parse(await readFile(result.cameraJson, 'utf8')) as {
      azimuthStartDeg: number;
      frames: number;
      perFrame: { i: number; azimuthDeg: number; elevationDeg: number }[];
    };
    const azimuthStartRad = degToRad(cameraJson.azimuthStartDeg);

    expect(cameraJson.perFrame).toHaveLength(8);
    for (const entry of cameraJson.perFrame) {
      const expectedAzimuthRad = azimuthForFrameIndex(entry.i, cameraJson.frames, azimuthStartRad);
      const actualAzimuthRad = degToRad(entry.azimuthDeg);
      expect(actualAzimuthRad).toBeCloseTo(expectedAzimuthRad, 9);
      expect(entry.elevationDeg).toBe(20);
    }
  });

  it('reports the computed StageParams with distance from fitDistance', () => {
    expect(result.stage.distance).toBeGreaterThan(0);
    expect(result.stage.fovDeg).toBe(35);
  });
});

describe('renderProxyFrames determinism', () => {
  it('renders byte-identical PNGs for the same frame across two runs under SwiftShader', async () => {
    const outDirA = await makeTmpDir();
    const outDirB = await makeTmpDir();
    try {
      const [resultA, resultB] = await Promise.all([
        renderProxyFrames(baseOptions(outDirA, { frames: 1 })),
        renderProxyFrames(baseOptions(outDirB, { frames: 1 })),
      ]);

      const pngA = await readFile(path.join(resultA.framesDir, '000.png'));
      const pngB = await readFile(path.join(resultB.framesDir, '000.png'));
      expect(pngA.equals(pngB)).toBe(true);
    } finally {
      await rm(outDirA, { recursive: true, force: true });
      await rm(outDirB, { recursive: true, force: true });
    }
  }, 120_000);
});
