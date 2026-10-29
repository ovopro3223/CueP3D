import { probeVideoStream } from './probe.js';

/**
 * D-004 — mechanical enforcement, mirrors scripts/assert-free-codecs.mjs at
 * the repo root (that script ffprobes for allowed codec_names; this list is
 * the brief's exact forbidden set, kept here so a match names *which*
 * legacy/other codec was found instead of just "not av1/vp9").
 */
export const FORBIDDEN_CODEC_TOKENS = [
  'h264',
  'hevc',
  'avc1',
  'hvc1',
  'hev1',
  'mpeg4',
  'vc1',
  'wmv3',
] as const;

const ALLOWED_CODECS = new Set(['av1', 'vp9']);

export interface CodecViolation {
  file: string;
  reason: string;
}

/**
 * ffprobes each path and throws if any codec is outside {av1, vp9}. Used by
 * encodeProxy's own output verification and exported for callers (e.g. a
 * future wiring of scripts/assert-free-codecs.mjs) that want the same check
 * as a library call instead of a CLI script.
 */
export async function assertFreeCodecs(paths: string[]): Promise<void> {
  const violations: CodecViolation[] = [];

  for (const file of paths) {
    let codec: string;
    try {
      const stream = await probeVideoStream(file);
      codec = (stream.codec_name ?? '').toLowerCase();
    } catch (error) {
      violations.push({
        file,
        reason: `ffprobe failed (${(error as Error).message.split('\n')[0]})`,
      });
      continue;
    }

    const forbiddenMatch = FORBIDDEN_CODEC_TOKENS.find((token) => codec.includes(token));
    if (forbiddenMatch) {
      violations.push({ file, reason: `forbidden codec "${codec}" (matches "${forbiddenMatch}")` });
      continue;
    }
    if (!ALLOWED_CODECS.has(codec)) {
      violations.push({ file, reason: `codec "${codec}" is not allowed (allowed: av1, vp9)` });
    }
  }

  if (violations.length > 0) {
    const summary = violations.map((v) => `  - ${v.file}: ${v.reason}`).join('\n');
    throw new Error(`Codec policy violation (D-004 — AV1 only, no H.264/H.265):\n${summary}`);
  }
}
