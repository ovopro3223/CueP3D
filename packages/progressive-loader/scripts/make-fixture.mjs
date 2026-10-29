#!/usr/bin/env node
/**
 * Builds fixtures/progressive-loader-cube.glb: a self-contained glTF cube
 * with EXT_meshopt_compression geometry and a KHR_texture_basisu (KTX2)
 * texture, for P5 (progressive-loader)'s Playwright tests.
 *
 * Geometry compression uses meshoptimizer's own WASM encoder (MeshoptEncoder)
 * via @gltf-transform/functions' `meshopt()` transform — no native tool
 * required. The texture is not re-encoded here: it is three.js's own
 * Basis-Universal test KTX2 (see fixtures/progressive-loader/NOTICE.md for
 * why), read from disk as-is and attached with KHRTextureBasisu.
 *
 * Usage: node packages/progressive-loader/scripts/make-fixture.mjs
 * (requires @gltf-transform/core, @gltf-transform/extensions and
 * @gltf-transform/functions — devDependencies of packages/progressive-loader;
 * run from the package directory, or via
 * `pnpm --filter @understudy3d/progressive-loader exec node scripts/make-fixture.mjs`,
 * so the bare imports resolve through its own node_modules)
 */
import { Document, Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const texturePath = path.join(repoRoot, 'fixtures', 'progressive-loader', 'source-texture.ktx2');
const outPath = path.join(repoRoot, 'fixtures', 'progressive-loader-cube.glb');

// Unit cube, 24 vertices (4 per face, so each face gets its own normal/UV),
// 12 triangles.
const FACES = [
  {
    normal: [0, 0, 1],
    verts: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  }, // +Z
  {
    normal: [0, 0, -1],
    verts: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  }, // -Z
  {
    normal: [1, 0, 0],
    verts: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  }, // +X
  {
    normal: [-1, 0, 0],
    verts: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  }, // -X
  {
    normal: [0, 1, 0],
    verts: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  }, // +Y
  {
    normal: [0, -1, 0],
    verts: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  }, // -Y
];
const UVS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function buildCubeAttributes() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  FACES.forEach((face, faceIndex) => {
    const base = faceIndex * 4;
    for (let i = 0; i < 4; i++) {
      const v = face.verts[i];
      positions.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
      normals.push(...face.normal);
      uvs.push(...UVS[i]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

async function main() {
  await MeshoptEncoder.ready;

  const ktx2 = await readFile(texturePath);

  const document = new Document();
  document.createExtension(KHRTextureBasisu).setRequired(true);

  const buffer = document.createBuffer();
  const { positions, normals, uvs, indices } = buildCubeAttributes();

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
  const uvAccessor = document
    .createAccessor('uv')
    .setType(Accessor.Type.VEC2)
    .setArray(uvs)
    .setBuffer(buffer);
  const indexAccessor = document
    .createAccessor('indices')
    .setType(Accessor.Type.SCALAR)
    .setArray(indices)
    .setBuffer(buffer);

  const texture = document.createTexture('cube-basis').setMimeType('image/ktx2').setImage(ktx2);

  const material = document.createMaterial('cube-material').setBaseColorTexture(texture);

  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setAttribute('NORMAL', normalAccessor)
    .setAttribute('TEXCOORD_0', uvAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);

  const mesh = document.createMesh('cube').addPrimitive(primitive);
  const node = document.createNode('cube').setMesh(mesh);
  document.createScene('scene').addChild(node);

  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const glb = await io.writeBinary(document);
  await writeFile(outPath, glb);

  const { size } = await stat(outPath);
  console.log(`Wrote ${outPath} (${size} bytes).`);
  if (size > 100_000) {
    throw new Error(`Fixture is ${size} bytes, over the 100 KB budget.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
