import type { Document } from '@gltf-transform/core';
import { Primitive } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import type { Vec3 } from '@understudy3d/manifest';

/**
 * Bounding sphere approximated from the AABB: centre is the box centre,
 * radius is the half-diagonal (distance from that centre to a box corner).
 * This is not the minimal enclosing sphere, but it is a stable, cheap,
 * deterministic upper bound — documented here per the brief, since
 * gltf-transform does not expose an exact bounding-sphere routine.
 */
export function computeBounds(document: Document): { center: Vec3; radius: number } {
  const scene = document.getRoot().listScenes()[0];
  if (!scene) {
    throw new Error('build-geometry: model has no scene to compute bounds from.');
  }
  const { min, max } = getBounds(scene);
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const half: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  const radius = Math.sqrt(half[0] * half[0] + half[1] * half[1] + half[2] * half[2]);
  return { center, radius };
}

/**
 * Sum of triangle counts across every TRIANGLES primitive in the document.
 * Each Mesh definition is counted once regardless of how many Nodes
 * instance it — this reports the model's drawable complexity, not the
 * per-frame GPU primitive count under instancing.
 */
export function countTriangles(document: Document): number {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      total += Math.floor(count / 3);
    }
  }
  return total;
}
