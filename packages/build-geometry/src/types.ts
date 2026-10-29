import type { Tier, Vec3 } from '@understudy3d/manifest';

export type TextureMode = 'etc1s' | 'uastc' | 'uastc-if-normal-or-orm-else-etc1s';

export interface TierSpec {
  id: 'L0' | 'L1' | 'L2';
  ratio: number;
  error?: number;
  maxTexture: number;
  texMode: TextureMode;
}

export interface BuildGeometryOptions {
  outDir: string;
  tiers?: TierSpec[];
  textures?: 'ktx2';
}

export interface BuildGeometryResult {
  normalizedGlb: string;
  bounds: { center: Vec3; radius: number };
  tiers: Tier[];
}

export const DEFAULT_TIERS: TierSpec[] = [
  { id: 'L0', ratio: 0.08, error: 0.01, maxTexture: 256, texMode: 'etc1s' },
  { id: 'L1', ratio: 0.35, error: 0.005, maxTexture: 1024, texMode: 'etc1s' },
  { id: 'L2', ratio: 1.0, maxTexture: 2048, texMode: 'uastc-if-normal-or-orm-else-etc1s' },
];
