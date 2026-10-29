import type { ProxyVariant } from '@cuep3d/manifest';
import { resolveUrl } from '@cuep3d/manifest';
import type { ProxyPlayer } from './types.js';
import { createWebCodecsProxyPlayer } from './webcodecs-player.js';
import { createVideoElementProxyPlayer } from './video-element-player.js';
import { createAvifSequenceProxyPlayer } from './avif-sequence-player.js';

/**
 * Dispatches to the decode strategy for an already-selected variant
 * (milestones A-D). `typeof VideoDecoder !== 'undefined'` is the same
 * capability gate selectProxyVariant used when it picked a video variant
 * via WebCodecs-or-canPlayType; this factory must return a ProxyPlayer
 * synchronously, so it is the practical boundary between the WebCodecs and
 * <video> paths here. Using this together with this package's own
 * selectProxyVariant (rather than some other selection scheme) is what
 * keeps that assumption true in practice.
 */
export function createProxyPlayer(variant: ProxyVariant, baseUrl: string): ProxyPlayer {
  if (variant.kind === 'image-sequence') {
    // The AVIF sequence player resolves each frame's URL itself (it must
    // substitute {i} into the still-relative pattern before resolving —
    // see avif-sequence-player.ts — so it needs baseUrl, not a pre-resolved
    // one-shot url like the single-file video variants below).
    return createAvifSequenceProxyPlayer(variant, baseUrl);
  }
  const url = resolveUrl(baseUrl, variant.url);
  if (typeof VideoDecoder !== 'undefined') {
    return createWebCodecsProxyPlayer(url);
  }
  return createVideoElementProxyPlayer(url);
}
