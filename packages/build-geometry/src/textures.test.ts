import { describe, expect, it } from 'vitest';

import { isNonColorTexture, roundDownToMultipleOf4 } from './textures.js';

describe('isNonColorTexture', () => {
  it('flags normal, occlusion and metallic-roughness slots as non-colour', () => {
    expect(isNonColorTexture(['normalTexture'])).toBe(true);
    expect(isNonColorTexture(['occlusionTexture'])).toBe(true);
    expect(isNonColorTexture(['metallicRoughnessTexture'])).toBe(true);
    expect(isNonColorTexture(['occlusionTexture', 'metallicRoughnessTexture'])).toBe(true);
  });

  it('treats base colour and emissive slots as colour data', () => {
    expect(isNonColorTexture(['baseColorTexture'])).toBe(false);
    expect(isNonColorTexture(['emissiveTexture'])).toBe(false);
    expect(isNonColorTexture([])).toBe(false);
  });
});

describe('roundDownToMultipleOf4', () => {
  it('leaves sizes already on a 4px grid unchanged', () => {
    expect(roundDownToMultipleOf4([256, 256])).toEqual([256, 256]);
    expect(roundDownToMultipleOf4([1024, 512])).toEqual([1024, 512]);
  });

  it('rounds down to the nearest multiple of 4', () => {
    expect(roundDownToMultipleOf4([257, 259])).toEqual([256, 256]);
    expect(roundDownToMultipleOf4([13, 13])).toEqual([12, 12]);
  });

  it('never rounds below the 4px minimum', () => {
    expect(roundDownToMultipleOf4([3, 1])).toEqual([4, 4]);
  });
});
