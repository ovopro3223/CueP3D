import * as THREE from 'three';
import { createStage } from '@cuep3d/stage';
import type { StageParams } from '@cuep3d/manifest';
import type { Tier } from '@cuep3d/manifest';
import { createProgressiveLoader, disposeObject } from '../src/index.js';

const KTX2_TRANSCODER_PATH = '/basis/';

function makeRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  return new THREE.WebGLRenderer({ canvas, antialias: false });
}

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) count++;
  });
  return count;
}

interface LoadResult {
  meshCount: number;
  progress: number[];
}

async function loadAndInspect(tier: Tier, baseUrl: string): Promise<LoadResult> {
  const renderer = makeRenderer();
  const loader = createProgressiveLoader(renderer, { ktx2TranscoderPath: KTX2_TRANSCODER_PATH });
  const progress: number[] = [];
  const root = await loader.loadTier(tier, baseUrl, (bytes) => progress.push(bytes));
  const meshCount = countMeshes(root);
  disposeObject(root);
  loader.dispose();
  renderer.dispose();
  return { meshCount, progress };
}

async function runOnce(
  tier: Tier,
  baseUrl: string,
  stageParams: StageParams,
  warm: boolean,
): Promise<number> {
  const renderer = makeRenderer();
  const stage = createStage(renderer, stageParams);
  const loader = createProgressiveLoader(renderer, { ktx2TranscoderPath: KTX2_TRANSCODER_PATH });

  const root = await loader.loadTier(tier, baseUrl);
  if (warm) await loader.warm(root, stage);

  stage.setModel(root);
  const t0 = performance.now();
  stage.render();
  const elapsedMs = performance.now() - t0;

  stage.setModel(null);
  disposeObject(root);
  loader.dispose();
  stage.dispose();
  renderer.dispose();
  return elapsedMs;
}

interface WarmVsColdResult {
  warmedMs: number;
  coldMs: number;
}

async function warmVsCold(
  tier: Tier,
  baseUrl: string,
  stageParams: StageParams,
): Promise<WarmVsColdResult> {
  // Order matters: ANGLE/the GPU process can cache a compiled program by
  // shader source across independent WebGLRenderer contexts within the same
  // browser session, so whichever case runs first pays the only truly cold
  // compile. Cold runs first here so it is never flattered by a cache primed
  // by the warmed case.
  const coldMs = await runOnce(tier, baseUrl, stageParams, false);
  const warmedMs = await runOnce(tier, baseUrl, stageParams, true);
  return { warmedMs, coldMs };
}

interface MemoryCounts {
  geometries: number;
  textures: number;
}

interface DisposeCheckResult {
  baseline: MemoryCounts;
  afterWarm: MemoryCounts;
  afterDispose: MemoryCounts;
}

function snapshotMemory(renderer: THREE.WebGLRenderer): MemoryCounts {
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}

/**
 * `createProgressiveLoader` owns a small internal WebGLRenderTarget (see
 * loader.ts) used by every `warm()` call; the renderer only registers its
 * texture in `info.memory.textures` once `warm()` actually renders into it,
 * and only releases it on `loader.dispose()`. So that this test measures
 * disposeObject's effect on the tier it was given — not the loader's own
 * fixed overhead — the final snapshot is taken after both disposeObject and
 * loader.dispose(), i.e. the same fully-torn-down state as the baseline.
 */
async function disposeCheck(
  tier: Tier,
  baseUrl: string,
  stageParams: StageParams,
): Promise<DisposeCheckResult> {
  const renderer = makeRenderer();
  const stage = createStage(renderer, stageParams);
  const loader = createProgressiveLoader(renderer, { ktx2TranscoderPath: KTX2_TRANSCODER_PATH });

  const baseline = snapshotMemory(renderer);

  const root = await loader.loadTier(tier, baseUrl);
  await loader.warm(root, stage);
  const afterWarm = snapshotMemory(renderer);

  disposeObject(root);
  loader.dispose();
  const afterDispose = snapshotMemory(renderer);

  stage.dispose();
  renderer.dispose();

  return { baseline, afterWarm, afterDispose };
}

declare global {
  interface Window {
    __pl: {
      loadAndInspect: typeof loadAndInspect;
      warmVsCold: typeof warmVsCold;
      disposeCheck: typeof disposeCheck;
    };
  }
}

window.__pl = { loadAndInspect, warmVsCold, disposeCheck };
