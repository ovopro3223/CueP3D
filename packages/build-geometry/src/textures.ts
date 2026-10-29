import type { Document } from '@gltf-transform/core';
import { fitWithin, listTextureSlots } from '@gltf-transform/functions';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { encodeKtx2 } from './toktx.js';
import type { TierSpec } from './types.js';

const NON_COLOR_SLOTS = new Set(['normalTexture', 'occlusionTexture', 'metallicRoughnessTexture']);

export function isNonColorTexture(slots: string[]): boolean {
  return slots.some((slot) => NON_COLOR_SLOTS.has(slot));
}

/**
 * ETC1S/UASTC block compression operates on 4x4 blocks; non-multiple-of-4
 * dimensions are rounded down to the nearest multiple (minimum 4) so toktx
 * never has to guess how to handle a partial block.
 */
export function roundDownToMultipleOf4(size: readonly [number, number]): [number, number] {
  const round = (n: number) => Math.max(4, Math.floor(n / 4) * 4);
  return [round(size[0]), round(size[1])];
}

export async function compressTexturesToKtx2(document: Document, spec: TierSpec): Promise<void> {
  const textures = document.getRoot().listTextures();
  let compressedAny = false;

  for (const texture of textures) {
    const mimeType = texture.getMimeType();
    if (mimeType === 'image/ktx2') continue;

    const image = texture.getImage();
    if (!image) continue;

    const size = texture.getSize();
    if (!size) {
      throw new Error(
        `build-geometry: could not determine pixel size of texture "${texture.getName() || '(unnamed)'}" ` +
          `(mime type ${mimeType}); cannot resize before KTX2 encoding.`,
      );
    }

    const slots = listTextureSlots(texture);
    const nonColor = isNonColorTexture(slots);
    const mode =
      spec.texMode === 'uastc-if-normal-or-orm-else-etc1s'
        ? nonColor
          ? 'uastc'
          : 'etc1s'
        : spec.texMode;

    const fitted = fitWithin(size, [spec.maxTexture, spec.maxTexture]);
    const needsResize = fitted[0] !== size[0] || fitted[1] !== size[1];

    const ktx2 = await encodeKtx2({
      image,
      mimeType,
      mode,
      colorspace: nonColor ? 'linear' : 'srgb',
      ...(needsResize ? { resize: roundDownToMultipleOf4(fitted) } : {}),
    });

    texture.setImage(ktx2).setMimeType('image/ktx2');
    compressedAny = true;
  }

  if (compressedAny) {
    document.createExtension(KHRTextureBasisu).setRequired(true);
  }
}
