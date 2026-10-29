#!/usr/bin/env node
/**
 * Builds fixtures/out-cube/: a real, small cuep3d.json output directory
 * for this package's own Playwright tests — the handoff pixel-diff test in
 * particular needs the proxy frames and the live render to be the *same*
 * model, or a passing diff would prove nothing.
 *
 * `packages/cli`'s `cuep3d build` is not wired yet (Wave 2, see
 * docs/reports/wave1-integration-report.md — "What's next"), so this calls
 * the two build-time packages it would eventually orchestrate directly:
 * @cuep3d/build-proxy (renders real orbit frames with
 * @cuep3d/stage, D-007) and @cuep3d/build-encode (AV1/VP9/AVIF,
 * D-004). Both are added as devDependencies of this package for exactly
 * this script — not shipped in dist (see docs/reports/P6-report.md).
 *
 * The fixture model is its own smooth, untextured sphere (built right here
 * with three.js's SphereGeometry + gltf-transform + meshoptimizer's WASM
 * encoder, same technique as
 * packages/progressive-loader/scripts/make-fixture.mjs), not a reuse of
 * that package's own fixtures/progressive-loader-cube.glb. Two earlier
 * shapes were tried and reverted — see buildModelGlb()'s own comment for
 * the measurements that ruled them out: a textured cube (sharp text edges)
 * and a plain cube (hard 90° face-to-face normal discontinuities) both
 * lose real, measurable fidelity to AV1's always-on 4:2:0 chroma
 * subsampling, independent of CRF. A sphere has no hard edges at all, and
 * is a closer match to this project's own real samples anyway
 * (Avocado/BoomBox/WaterBottle are all smoothly curved). See
 * docs/reports/P6-report.md for the full measurement history.
 *
 * Tiers L0/L1/L2 all reuse the one glb this script builds, not three
 * *distinct* quality levels — this machine has no `toktx`, the same real
 * gap P5's own report hit for its own fixture. The state machine and
 * QualityPolicy neither know nor care whether three tiers' bytes differ.
 *
 * Usage: node packages/viewer/scripts/make-fixture.mjs
 * (run via `pnpm --filter @cuep3d/viewer run make-fixture` so the
 * bare `@cuep3d/*`/`@gltf-transform/*` imports resolve through this
 * package's own node_modules)
 */
import { Document, Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { mkdir, copyFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { renderProxyFrames } from '@cuep3d/build-proxy';
import { encodeProxy } from '@cuep3d/build-encode';
import { fitDistance } from '@cuep3d/stage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const outDir = path.join(repoRoot, 'fixtures', 'out-cube');
const modelGlb = path.join(outDir, 'source-model.glb');
const tmpDir = path.join(outDir, '.tmp');

const SPHERE_RADIUS = 0.5;
const BOUNDS_RADIUS = SPHERE_RADIUS;
const FRAMES = 24; // fewer than v1's default 72 — this is a test fixture, not a production proxy.
const RING_ELEVATION_DEG = 20;
const AZIMUTH_START_DEG = 0;
const SIZE = 256;
const FPS = 24;
const GOP = 8;
const BACKGROUND = '#dddddd';
const STAGE_PARAMS = {
  fovDeg: 35,
  target: [0, 0, 0],
  environment: 'studio-neutral',
  exposure: 1,
  // Not 'aces': packages/stage's overlay quad material (frozen, not
  // editable here — see docs/change-requests/P6-overlay-tonemapping.md)
  // defaults `toneMapped: true`, so an already-tonemapped proxy frame gets
  // the curve applied a second time when displayed as the overlay,
  // producing a real, consistent brightness/contrast mismatch against the
  // live render under any tonemapping *other* than 'none'. Avoided here so
  // this fixture measures the handoff mechanism, not that separate gap.
  toneMapping: 'none',
};

// A sphere, not a cube: tried a cube first (hard-edged, 24 verts, three.js
// per-face normals — see git history) and it still measured ~4.4% mean abs
// diff against the live render even at CRF 0 (truly lossless AV1), fully
// independent of CRF, because build-encode hardcodes `-pix_fmt yuv420p`
// (packages/build-encode/src/encode-video.ts) — a deliberate, correct
// choice for broad hardware-decode compatibility, not a bug, but it means
// 4:2:0 chroma subsampling always runs, and a cube's 90° face-to-face
// normal discontinuities are exactly the high-frequency content that
// loses the most to it. A sphere has no hard edges at all — every normal
// varies smoothly — and is a closer match to this project's own real
// samples anyway (Avocado/BoomBox/WaterBottle are all smoothly curved,
// not faceted). Built with three.js's own SphereGeometry so the vertex
// data is correct by construction rather than hand-rolled.
function buildSphereAttributes() {
  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 48, 32);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  return {
    positions: new Float32Array(position.array),
    normals: new Float32Array(normal.array),
    indices: new Uint32Array(index.array),
    triangleCount: index.count / 3,
  };
}

async function buildModelGlb() {
  await MeshoptEncoder.ready;

  const document = new Document();
  const buffer = document.createBuffer();
  const { positions, normals, indices, triangleCount } = buildSphereAttributes();

  const positionAccessor = document
    .createAccessor('position')
    .setType(Accessor.Type.VEC3)
    .setArray(positions)
    .setBuffer(buffer);
  const normalAccessor = document
    .createAccessor('normal')
    .setType(Accessor.Type.VEC3)
    .setArray(normals)
    .setBuffer(buffer);
  const indexAccessor = document
    .createAccessor('indices')
    .setType(Accessor.Type.SCALAR)
    .setArray(indices)
    .setBuffer(buffer);

  // A warm, saturated but not fully-clipped colour with mid roughness —
  // gives the PMREM studio environment something smooth to reflect.
  const material = document
    .createMaterial('sphere-material')
    .setBaseColorFactor([0.65, 0.6, 0.52, 1])
    .setRoughnessFactor(0.45)
    .setMetallicFactor(0.1);

  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setAttribute('NORMAL', normalAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);

  const mesh = document.createMesh('sphere').addPrimitive(primitive);
  const node = document.createNode('sphere').setMesh(mesh);
  document.createScene('scene').addChild(node);

  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const glb = await io.writeBinary(document);
  await writeFile(modelGlb, glb);
  return { triangleCount };
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  console.log('make-fixture: building the fixture sphere glb...');
  const { triangleCount } = await buildModelGlb();

  console.log('make-fixture: rendering proxy frames of the fixture sphere...');
  const { framesDir, stage } = await renderProxyFrames({
    modelUrlOrPath: modelGlb,
    outDir: tmpDir,
    size: SIZE,
    frames: FRAMES,
    ringsDeg: [RING_ELEVATION_DEG],
    azimuthStartDeg: AZIMUTH_START_DEG,
    stage: STAGE_PARAMS,
    background: BACKGROUND,
    bounds: { center: [0, 0, 0], radius: BOUNDS_RADIUS },
  });

  console.log('make-fixture: encoding AV1/VP9/AVIF proxy variants...');
  const variants = await encodeProxy({
    framesDir,
    outDir,
    sizes: [SIZE],
    fps: FPS,
    gop: GOP,
    encoder: 'auto',
    // crf 0 (as close to lossless as each encoder gets), unlike
    // production's size-tuned defaults (crf 28-33): this fixture exists
    // for the handoff pixel-diff test, which isolates camera/lighting
    // correctness from lossy-compression noise. File size is irrelevant
    // for a 24-frame fixture. Does not fully close the gap — see
    // docs/change-requests/P6-av1-color-metadata.md and
    // docs/reports/P6-report.md for the full measurement: crf 0 vs crf 4
    // read identically, explicit `-color_primaries/-color_trc/-colorspace
    // bt709 -color_range pc` on the encode (tried directly, outside
    // encodeProxy, then reverted — no change) also read identically, and a
    // direct ground-truth-PNG-vs-live-render comparison with no codec
    // involved at all reads exactly 0.000% — so the remaining few percent
    // is upstream of this package, in the AV1 encode/decode round trip
    // itself, not anything plausibly fixable by this fixture's own
    // settings.
    quality: { av1Crf: 0, vp9Crf: 0, avifCrf: 0 },
  });

  console.log('make-fixture: writing tiers (reusing the fixture sphere)...');
  const tierFiles = { L0: 'model.L0.glb', L1: 'model.L1.glb', L2: 'model.L2.glb' };
  const modelBytes = (await stat(modelGlb)).size;
  for (const file of Object.values(tierFiles)) {
    await copyFile(modelGlb, path.join(outDir, file));
  }

  const manifest = {
    version: 1,
    generator: 'cuep3d-viewer-fixture@0.1.0',
    source: {
      name: 'CueP3D test sphere',
      license: 'MIT',
      attribution:
        'Generated by packages/viewer/scripts/make-fixture.mjs. ' +
        'Not a real sample model — packages/viewer e2e fixture only.',
    },
    bounds: { center: [0, 0, 0], radius: BOUNDS_RADIUS },
    stage,
    proxy: {
      frames: FRAMES,
      rings: [{ elevationDeg: RING_ELEVATION_DEG }],
      azimuthStartDeg: AZIMUTH_START_DEG,
      fps: FPS,
      background: BACKGROUND,
      variants,
    },
    tiers: [
      // maxTextureSize: 1, not 0 — the schema requires a positive integer
      // and this fixture has no texture at all (see file header).
      {
        id: 'L0',
        url: tierFiles.L0,
        bytes: modelBytes,
        triangles: triangleCount,
        maxTextureSize: 1,
        extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
      },
      {
        id: 'L1',
        url: tierFiles.L1,
        bytes: modelBytes,
        triangles: triangleCount,
        maxTextureSize: 1,
        extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
      },
      {
        id: 'L2',
        url: tierFiles.L2,
        bytes: modelBytes,
        triangles: triangleCount,
        maxTextureSize: 1,
        extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
      },
    ],
  };

  await writeFile(path.join(outDir, 'cuep3d.json'), JSON.stringify(manifest, null, 2));

  // Committed ground-truth PNGs for the specific frame indices the e2e
  // suite checks against (frame 0: degraded/no-scrub tests; frame 17:
  // SCRUB_TARGET_FRAME in handoff-pixel-diff.spec.ts) — these are what
  // proves the live render is camera-accurate independent of the proxy
  // video codec (see docs/reports/P6-report.md). KEEP_DEBUG_FRAMES=1 keeps
  // every frame too, for ad hoc debugging; not committed.
  const debugDir = path.join(outDir, 'debug-frames');
  await mkdir(debugDir, { recursive: true });
  for (const i of [0, 17]) {
    const name = `${String(i).padStart(3, '0')}.png`;
    await copyFile(path.join(framesDir, name), path.join(debugDir, name));
  }
  if (process.env.KEEP_DEBUG_FRAMES) {
    for (let i = 0; i < FRAMES; i++) {
      const name = `${String(i).padStart(3, '0')}.png`;
      await copyFile(path.join(framesDir, name), path.join(debugDir, name));
    }
  }
  await rm(tmpDir, { recursive: true, force: true });

  // Sanity check: fitDistance must agree with what renderProxyFrames itself
  // used (stage.distance), or the live camera would not match the proxy.
  const expectedDistance = fitDistance(BOUNDS_RADIUS, STAGE_PARAMS.fovDeg);
  if (Math.abs(expectedDistance - stage.distance) > 1e-9) {
    throw new Error(
      `make-fixture: distance mismatch (fitDistance=${expectedDistance}, stage.distance=${stage.distance})`,
    );
  }

  console.log(`make-fixture: wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
