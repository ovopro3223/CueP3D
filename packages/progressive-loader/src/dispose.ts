import * as THREE from 'three';
import { collectTextures } from './textures.js';

/**
 * Releases every GPU resource owned by a loaded tier: geometries, materials
 * and their textures. Called by the viewer when a tier is replaced
 * (D-008 — tiers are self-contained, so nothing here is shared with the
 * next tier's root).
 */
export function disposeObject(root: THREE.Object3D): void {
  for (const texture of collectTextures(root)) {
    texture.dispose();
  }

  const disposedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material && !disposedMaterials.has(material)) {
        disposedMaterials.add(material);
        material.dispose();
      }
    }
  });
}
