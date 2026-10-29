import { z } from 'zod';

/**
 * Schema for understudy.json. Matches docs/01-design.md §5.2 exactly —
 * that section is the source of truth; keep this file in sync with it.
 */

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const StageParamsSchema = z.object({
  fovDeg: z.number().positive(),
  distance: z.number().positive(),
  target: Vec3Schema,
  environment: z.enum(['studio-neutral', 'studio-warm', 'none']),
  exposure: z.number().positive(),
  toneMapping: z.enum(['aces', 'neutral', 'none']),
});

export const ProxyVariantSchema = z.object({
  kind: z.enum(['video', 'image-sequence']),
  codec: z.enum(['av01', 'vp09', 'avif']),
  container: z.literal('mp4').optional(),
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
  gop: z.number().int().positive().optional(),
  /**
   * Frame count, same for every variant of one proxy (redundant with
   * Manifest.proxy.frames, convenient per-variant like `gop`). A video
   * variant self-describes this via its MP4 sample table; an image-sequence
   * variant has no container to read it from, so it's carried here instead
   * of requiring a discovery probe. See D-005c.
   */
  frames: z.number().int().positive(),
});

export const TierSchema = z.object({
  id: z.enum(['L0', 'L1', 'L2']),
  url: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  triangles: z.number().int().nonnegative(),
  maxTextureSize: z.number().int().positive(),
  extensions: z.array(z.string()),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  generator: z.string().min(1),
  source: z.object({
    name: z.string().min(1),
    license: z.string().optional(),
    attribution: z.string().optional(),
  }),
  bounds: z.object({
    center: Vec3Schema,
    radius: z.number().positive(),
  }),
  stage: StageParamsSchema,
  proxy: z.object({
    frames: z.number().int().positive(),
    rings: z.array(z.object({ elevationDeg: z.number() })).min(1),
    azimuthStartDeg: z.number(),
    fps: z.number().positive(),
    background: z.string().min(1),
    variants: z.array(ProxyVariantSchema).min(1),
  }),
  tiers: z.array(TierSchema).min(1),
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type StageParams = z.infer<typeof StageParamsSchema>;
export type ProxyVariant = z.infer<typeof ProxyVariantSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
