import type { ProxyVariant } from '@understudy3d/manifest';
import {
  canPlayTypeSupported,
  defaultCodecString,
  isVideoDecoderConfigSupported,
  type VideoCodecKind,
} from './codec-support.js';
import { probeAvifSupport } from './avif-probe.js';

/**
 * Frozen to a single `variants` argument (§5.4) — no baseUrl, so this
 * cannot fetch the real file to read its exact profile/level from the
 * container (createProxyPlayer does that once it has a baseUrl and is
 * committed to fetching anyway). Selection therefore probes with the
 * brief's documented default level string per codec family: good enough to
 * answer "can this browser decode AV1/VP9 at all," which is what picking
 * between manifest-ordered variants actually needs.
 */
async function isVideoVariantSupported(variant: ProxyVariant): Promise<boolean> {
  const codec = defaultCodecString(variant.codec as VideoCodecKind);
  const viaWebCodecs = await isVideoDecoderConfigSupported(codec, variant.width, variant.height);
  if (viaWebCodecs) return true;
  return canPlayTypeSupported(codec);
}

/**
 * Iterates variants in manifest order (the manifest already orders them by
 * preference — D-004's fallback chain) and returns the first one this
 * browser can actually play, probing capability rather than assuming it.
 */
export async function selectProxyVariant(
  variants: readonly ProxyVariant[],
): Promise<ProxyVariant | null> {
  for (const variant of variants) {
    if (variant.kind === 'video') {
      if (await isVideoVariantSupported(variant)) return variant;
      continue;
    }
    // image-sequence (AVIF, per D-004 — no other still-image fallback exists)
    if (await probeAvifSupport()) return variant;
  }
  return null;
}
