import * as THREE from 'three';

/**
 * Every unique THREE.Texture referenced by any material property on any
 * mesh under `root` (map, normalMap, roughnessMap, ... whatever GLTFLoader
 * assigned) — found structurally rather than by an explicit property list,
 * since PBR extensions keep adding new map slots.
 */
export function collectTextures(root: THREE.Object3D): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  return [...textures];
}
