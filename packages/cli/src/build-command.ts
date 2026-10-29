import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildGeometry } from '@understudy3d/build-geometry';
import { renderProxyFrames } from '@understudy3d/build-proxy';
import { encodeProxy } from '@understudy3d/build-encode';
import { validateManifest, type Manifest } from '@understudy3d/manifest';
import type { BuildArgs } from './parse-build-args.js';

const GENERATOR = 'understudy-cli@0.1.0';
const FOV_DEG = 35;
const FPS = 24;

/**
 * Orchestrates P1 (build-geometry) -> P2 (build-proxy) -> P3 (build-encode)
 * and assembles understudy.json. P1 and P3 write their outputs directly into
 * `outDir` (tier .glb files, proxy videos/AVIF sequences) since Tier.url and
 * ProxyVariant.url are resolved relative to the manifest; P2's frames and
 * camera.json are build-time-only inputs to P3, so they go in a `.proxy-source`
 * subdirectory that nothing in the manifest ever points at.
 */
export async function runBuild(args: BuildArgs): Promise<void> {
  const largestSize = Math.max(...args.proxySizes);

  console.log(`understudy build: ${args.input} -> ${args.outDir}`);

  console.log('[1/3] build-geometry: normalizing and building L0/L1/L2 tiers...');
  const geometry = await buildGeometry(args.input, { outDir: args.outDir, textures: 'ktx2' });
  console.log(`  tiers: ${geometry.tiers.map((t) => `${t.id}=${t.bytes}B`).join(', ')}`);

  console.log(`[2/3] build-proxy: rendering ${args.frames} orbit frames at ${largestSize}px...`);
  const proxySourceDir = path.join(args.outDir, '.proxy-source');
  const proxyFrames = await renderProxyFrames({
    modelUrlOrPath: geometry.normalizedGlb,
    outDir: proxySourceDir,
    size: largestSize,
    frames: args.frames,
    ringsDeg: args.ringsDeg,
    azimuthStartDeg: 0,
    stage: {
      fovDeg: FOV_DEG,
      target: [0, 0, 0],
      environment: args.environment,
      exposure: 1,
      toneMapping: 'aces',
    },
    background: args.background,
    bounds: { center: geometry.bounds.center, radius: geometry.bounds.radius },
    onProgress: (rendered, total) => {
      if (rendered === total || rendered % 12 === 0) {
        console.log(`  rendered ${rendered}/${total} frames`);
      }
    },
  });

  console.log('[3/3] build-encode: encoding AV1/VP9/AVIF proxy variants...');
  const variants = await encodeProxy({
    framesDir: proxyFrames.framesDir,
    outDir: args.outDir,
    sizes: args.proxySizes,
    fps: FPS,
    gop: 8,
    encoder: args.encoder,
  });
  console.log(`  variants: ${variants.map((v) => `${v.codec}@${v.width}`).join(', ')}`);

  const manifest: Manifest = {
    version: 1,
    generator: GENERATOR,
    source: { name: path.basename(args.input, path.extname(args.input)) },
    bounds: { center: geometry.bounds.center, radius: geometry.bounds.radius },
    stage: proxyFrames.stage,
    proxy: {
      frames: args.frames,
      rings: args.ringsDeg.map((elevationDeg) => ({ elevationDeg })),
      azimuthStartDeg: 0,
      fps: FPS,
      background: args.background,
      variants,
    },
    tiers: geometry.tiers,
  };

  const manifestPath = path.join(args.outDir, 'understudy.json');
  await writeFile(manifestPath, JSON.stringify(validateManifest(manifest), null, 2));
  console.log(`Wrote ${manifestPath}`);
}
