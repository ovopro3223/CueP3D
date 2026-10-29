import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';

import { computeBounds, countTriangles } from './geometry.js';

function buildTriangleDoc(): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]))
    .setBuffer(buffer);
  const indices = document
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setIndices(indices);
  const mesh = document.createMesh().addPrimitive(primitive);
  const node = document.createNode().setMesh(mesh);
  document.createScene().addChild(node);
  return document;
}

describe('computeBounds', () => {
  it('returns the AABB centre and the half-diagonal length as radius', () => {
    const { center, radius } = computeBounds(buildTriangleDoc());
    expect(center[0]).toBeCloseTo(1, 10);
    expect(center[1]).toBeCloseTo(1, 10);
    expect(center[2]).toBeCloseTo(0, 10);
    // half-extents are [1, 1, 0] -> half-diagonal = sqrt(2)
    expect(radius).toBeCloseTo(Math.SQRT2, 10);
  });

  it('throws when the document has no scene', () => {
    expect(() => computeBounds(new Document())).toThrow();
  });
});

describe('countTriangles', () => {
  it('counts an indexed TRIANGLES primitive as one triangle', () => {
    expect(countTriangles(buildTriangleDoc())).toBe(1);
  });

  it('counts a non-indexed TRIANGLES primitive from vertex count', () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(18)) // 6 vertices -> 2 triangles
      .setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position);
    const mesh = document.createMesh().addPrimitive(primitive);
    const node = document.createNode().setMesh(mesh);
    document.createScene().addChild(node);

    expect(countTriangles(document)).toBe(2);
  });

  it('ignores primitives that are not in TRIANGLES mode', () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
      .setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position).setMode(1); // LINES
    const mesh = document.createMesh().addPrimitive(primitive);
    const node = document.createNode().setMesh(mesh);
    document.createScene().addChild(node);

    expect(countTriangles(document)).toBe(0);
  });

  it('sums triangles across multiple meshes', () => {
    const document = buildTriangleDoc();
    const buffer = document.getRoot().listBuffers()[0]!;
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([5, 0, 0, 7, 0, 0, 5, 2, 0]))
      .setBuffer(buffer);
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint16Array([0, 1, 2]))
      .setBuffer(buffer);
    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setIndices(indices);
    const mesh = document.createMesh().addPrimitive(primitive);
    const node = document.createNode().setMesh(mesh);
    document.getRoot().listScenes()[0]!.addChild(node);

    expect(countTriangles(document)).toBe(2);
  });
});
