import type { Document } from '@gltf-transform/core';
import { center, dedup, flatten, prune, weld } from '@gltf-transform/functions';

/**
 * Centres and cleans the document in place: dedup -> prune -> flatten
 * (skipped when the model has animations or skins, since baking node
 * transforms into meshes would break them) -> weld -> center on the
 * bounding-box pivot. No simplification and no texture/geometry
 * compression here — this is the pass shared by the normalized .glb and
 * every tier.
 */
export async function normalizeDocument(document: Document): Promise<void> {
  const root = document.getRoot();
  const canFlatten = root.listAnimations().length === 0 && root.listSkins().length === 0;

  const transforms = [dedup(), prune()];
  if (canFlatten) {
    transforms.push(flatten());
  }
  transforms.push(weld(), center({ pivot: 'center' }));

  await document.transform(...transforms);
}
