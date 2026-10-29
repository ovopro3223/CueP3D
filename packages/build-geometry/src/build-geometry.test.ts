import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KHR_DF_MODEL_ETC1S, KHR_DF_MODEL_UASTC, read as readKtx2 } from 'ktx-parse';
import type { Texture } from '@gltf-transform/core';

import { buildGeometry } from './build-geometry.js';
import { createIO } from './gltf-io.js';
import { ensureToktx } from './toktx.js';
import { DEFAULT_TIERS } from './types.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const samplesDir = path.join(repoRoot, 'samples');

async function isToktxAvailable(): Promise<boolean> {
  try {
    await execFileAsync('toktx', ['--version']);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }
}

const toktxAvailable = await isToktxAvailable();

async function makeTmpDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function ktx2ColorModel(texture: Texture): number {
  const image = texture.getImage();
  if (!image) throw new Error('texture has no image data');
  const container = readKtx2(image);
  return container.dataFormatDescriptor[0]?.colorModel ?? -1;
}

describe('ensureToktx', () => {
  it('resolves when toktx is on PATH, otherwise throws a one-line install hint', async () => {
    try {
      await ensureToktx();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/toktx.*not found on PATH/i);
      expect(message).toMatch(/KTX-Software/);
    }
  });
});

describe.skipIf(!toktxAvailable)(
  'buildGeometry: Avocado.glb tiers (requires toktx — install KTX-Software to run this suite)',
  () => {
    let outDir: string;
    let result: Awaited<ReturnType<typeof buildGeometry>>;

    beforeAll(async () => {
      outDir = await makeTmpDir('understudy-build-geometry-avocado-');
      result = await buildGeometry(path.join(samplesDir, 'Avocado.glb'), { outDir });
    }, 180_000);

    afterAll(async () => {
      await rm(outDir, { recursive: true, force: true });
    });

    it('writes three tiers in ascending order', () => {
      expect(result.tiers.map((tier) => tier.id)).toEqual(['L0', 'L1', 'L2']);
    });

    it('keeps L0 under the 150 KB budget', () => {
      const l0 = result.tiers.find((tier) => tier.id === 'L0')!;
      expect(l0.bytes).toBeLessThan(150_000);
    });

    it('grows bytes from L1 to L2', () => {
      const l1 = result.tiers.find((tier) => tier.id === 'L1')!;
      const l2 = result.tiers.find((tier) => tier.id === 'L2')!;
      expect(l1.bytes).toBeLessThan(l2.bytes);
    });

    it('increases triangle count strictly from L0 to L1 to L2', () => {
      const [l0, l1, l2] = result.tiers;
      expect(l0!.triangles).toBeLessThan(l1!.triangles);
      expect(l1!.triangles).toBeLessThan(l2!.triangles);
    });

    it('declares EXT_meshopt_compression and KHR_texture_basisu on every tier', () => {
      for (const tier of result.tiers) {
        expect(tier.extensions).toContain('EXT_meshopt_compression');
        expect(tier.extensions).toContain('KHR_texture_basisu');
      }
    });

    it('computes a positive bounding radius and a centre within 1e-4 of the origin', () => {
      expect(result.bounds.radius).toBeGreaterThan(0);
      for (const component of result.bounds.center) {
        expect(Math.abs(component)).toBeLessThan(1e-4);
      }
    });

    it('re-reads each tier with gltf-transform and keeps textures within the tier max size', async () => {
      const io = await createIO();
      for (const spec of DEFAULT_TIERS) {
        const tier = result.tiers.find((t) => t.id === spec.id)!;
        const doc = await io.read(path.join(outDir, tier.url));
        const textures = doc.getRoot().listTextures();
        expect(textures.length).toBeGreaterThan(0);
        for (const texture of textures) {
          expect(texture.getMimeType()).toBe('image/ktx2');
          const size = texture.getSize();
          expect(size).not.toBeNull();
          expect(size![0]).toBeLessThanOrEqual(spec.maxTexture);
          expect(size![1]).toBeLessThanOrEqual(spec.maxTexture);
        }
      }
    });
  },
);

describe.skipIf(!toktxAvailable)(
  'buildGeometry: WaterBottle.glb texture mode selection (requires toktx)',
  () => {
    let outDir: string;
    let result: Awaited<ReturnType<typeof buildGeometry>>;

    beforeAll(async () => {
      outDir = await makeTmpDir('understudy-build-geometry-waterbottle-');
      result = await buildGeometry(path.join(samplesDir, 'WaterBottle.glb'), { outDir });
    }, 180_000);

    afterAll(async () => {
      await rm(outDir, { recursive: true, force: true });
    });

    it('encodes L2 normal/occlusion/metallic-roughness textures as UASTC and colour textures as ETC1S', async () => {
      const io = await createIO();
      const l2 = result.tiers.find((tier) => tier.id === 'L2')!;
      const doc = await io.read(path.join(outDir, l2.url));

      let checkedNonColor = 0;
      let checkedColor = 0;
      for (const material of doc.getRoot().listMaterials()) {
        const baseColor = material.getBaseColorTexture();
        if (baseColor) {
          expect(ktx2ColorModel(baseColor)).toBe(KHR_DF_MODEL_ETC1S);
          checkedColor++;
        }
        const normal = material.getNormalTexture();
        if (normal) {
          expect(ktx2ColorModel(normal)).toBe(KHR_DF_MODEL_UASTC);
          checkedNonColor++;
        }
        const metallicRoughness = material.getMetallicRoughnessTexture();
        if (metallicRoughness) {
          expect(ktx2ColorModel(metallicRoughness)).toBe(KHR_DF_MODEL_UASTC);
          checkedNonColor++;
        }
      }
      // Sanity: WaterBottle was picked (D-005a) specifically for having both
      // a colour and a normal/ORM texture, so both branches must have run.
      expect(checkedColor).toBeGreaterThan(0);
      expect(checkedNonColor).toBeGreaterThan(0);
    });
  },
);

describe.skipIf(!toktxAvailable)(
  'buildGeometry: .gltf with external resources (requires toktx)',
  () => {
    it('produces the same triangle counts, and comparable byte sizes, as the equivalent .glb', async () => {
      const io = await createIO();
      const glbPath = path.join(samplesDir, 'Avocado.glb');
      const sourceDoc = await io.read(glbPath);

      const gltfDir = await makeTmpDir('understudy-build-geometry-gltf-src-');
      const gltfPath = path.join(gltfDir, 'model.gltf');
      await io.write(gltfPath, sourceDoc);

      const outGlb = await makeTmpDir('understudy-build-geometry-from-glb-');
      const outGltf = await makeTmpDir('understudy-build-geometry-from-gltf-');

      try {
        const fromGlb = await buildGeometry(glbPath, { outDir: outGlb });
        const fromGltf = await buildGeometry(gltfPath, { outDir: outGltf });

        expect(fromGltf.tiers.map((t) => t.triangles)).toEqual(
          fromGlb.tiers.map((t) => t.triangles),
        );

        for (let i = 0; i < fromGlb.tiers.length; i++) {
          const a = fromGlb.tiers[i]!.bytes;
          const b = fromGltf.tiers[i]!.bytes;
          expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.05);
        }
      } finally {
        await rm(gltfDir, { recursive: true, force: true });
        await rm(outGlb, { recursive: true, force: true });
        await rm(outGltf, { recursive: true, force: true });
      }
    }, 240_000);
  },
);
