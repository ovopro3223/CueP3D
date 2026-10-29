import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { cloneDocument, meshopt, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Logger } from '@gltf-transform/core';
import type { Document } from '@gltf-transform/core';
import type { Tier } from '@understudy3d/manifest';

import { createIO } from './gltf-io.js';
import { computeBounds, countTriangles } from './geometry.js';
import { normalizeDocument } from './normalize.js';
import { compressTexturesToKtx2 } from './textures.js';
import { ensureToktx } from './toktx.js';
import { DEFAULT_TIERS } from './types.js';
import type { BuildGeometryOptions, BuildGeometryResult, TierSpec } from './types.js';

async function buildTier(source: Document, spec: TierSpec): Promise<Document> {
  const tierDoc = cloneDocument(source);
  tierDoc.setLogger(new Logger(Logger.Verbosity.WARN));

  if (spec.ratio < 1) {
    await tierDoc.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: spec.ratio,
        error: spec.error ?? 0.0001,
      }),
    );
  }

  await compressTexturesToKtx2(tierDoc, spec);

  // meshopt() wraps reorder + quantize + EXT_meshopt_compression setup
  // (incl. marking the extension required) in one step.
  await tierDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  return tierDoc;
}

export async function buildGeometry(
  input: string,
  options: BuildGeometryOptions,
): Promise<BuildGeometryResult> {
  await ensureToktx();

  const tierSpecs = options.tiers ?? DEFAULT_TIERS;
  await mkdir(options.outDir, { recursive: true });

  const io = await createIO();
  const sourceDoc = await io.read(input);
  sourceDoc.setLogger(new Logger(Logger.Verbosity.WARN));

  await normalizeDocument(sourceDoc);
  const bounds = computeBounds(sourceDoc);

  const normalizedGlb = path.join(options.outDir, 'model.norm.glb');
  await io.write(normalizedGlb, sourceDoc);

  const tiers: Tier[] = [];
  for (const spec of tierSpecs) {
    const tierDoc = await buildTier(sourceDoc, spec);

    const url = `model.${spec.id}.glb`;
    const outPath = path.join(options.outDir, url);
    await io.write(outPath, tierDoc);

    const { size: bytes } = await stat(outPath);
    const triangles = countTriangles(tierDoc);
    const extensions = tierDoc
      .getRoot()
      .listExtensionsUsed()
      .map((extension) => extension.extensionName);

    tiers.push({
      id: spec.id,
      url,
      bytes,
      triangles,
      maxTextureSize: spec.maxTexture,
      extensions,
    });
  }

  return { normalizedGlb, bounds, tiers };
}
