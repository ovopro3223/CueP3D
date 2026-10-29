import { z } from 'zod';

/**
 * Schema for cuep3d.json. Matches docs/01-design.md §5.2 exactly —
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

/**
 * Frame 0 of ring 0 as one AVIF still, carried inside the manifest as a
 * `data:` URL so the first visual costs no round trip beyond the manifest's
 * own (D-014). Encoded from the same rendered PNG as the video variants, at
 * the smallest variant size, so it is the picture the proxy's first
 * keyframe will show a moment later. Optional: a manifest without it is
 * still valid and the viewer simply waits for the first decoded video frame.
 */
export const ProxyPosterSchema = z.object({
  codec: z.literal('avif'),
  /** A `data:image/avif;base64,…` URL (or any URL resolvable against the manifest). */
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Encoded AVIF size in bytes (before base64). */
  bytes: z.number().int().nonnegative(),
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
    poster: ProxyPosterSchema.optional(),
  }),
  tiers: z.array(TierSchema).min(1),
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type StageParams = z.infer<typeof StageParamsSchema>;
export type ProxyVariant = z.infer<typeof ProxyVariantSchema>;
export type ProxyPoster = z.infer<typeof ProxyPosterSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
