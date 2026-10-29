import { createFile, MP4BoxBuffer } from 'mp4box';
import { getSampleEntryDescription } from './mp4-description.js';

export type VideoCodecKind = 'av01' | 'vp09';

/**
 * Fallback RFC 6381 codec strings when the exact profile/level can't be
 * read from the container (brief §E): a conservative level that any device
 * supporting the codec family at all should accept.
 */
const DEFAULT_LEVEL_CODEC_STRING: Record<VideoCodecKind, string> = {
  av01: 'av01.0.08M.08',
  vp09: 'vp09.00.31.08',
};

/** The brief's documented default level string for a codec family, with no I/O. */
export function defaultCodecString(codecKind: VideoCodecKind): string {
  return DEFAULT_LEVEL_CODEC_STRING[codecKind];
}

/** Enough for ftyp+moov on a +faststart proxy file without fetching the whole video. */
const MOOV_PROBE_BYTES = 262_144;

/**
 * D-004 is enforced at build time (assert-free-codecs); this is a runtime
 * safety net so this package never configures a decoder with, or reports
 * support for, a codec string outside the AV1/VP9 policy — even if fed a
 * mismatched or malformed file. An allowlist rather than a blocklist, so
 * nothing here needs to spell out the identifiers it refuses (the repo's
 * own codec gate treats any source file naming them as a violation, itself
 * excepted since naming them is its job).
 */
export function isAllowedCodecString(codec: string): boolean {
  return (Object.keys(DEFAULT_LEVEL_CODEC_STRING) as VideoCodecKind[]).some((kind) =>
    codec.startsWith(kind),
  );
}

export interface ResolvedVideoCodec {
  codec: string;
  description?: Uint8Array;
}

/**
 * The exact codec string (profile/level/tier/bit depth) by parsing just the
 * moov box from the start of the file — mp4box.js derives this directly
 * from the av1C/vpcC sample-entry box, so it is exact rather than guessed.
 * Falls back to resolveVideoCodec's documented default level string if the
 * moov isn't reachable within the probe window (Range unsupported, or an
 * unusually large moov).
 */
export async function resolveVideoCodec(
  url: string,
  codecKind: VideoCodecKind,
): Promise<ResolvedVideoCodec> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${MOOV_PROBE_BYTES - 1}` },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`moov probe fetch failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const resolved = await new Promise<ResolvedVideoCodec | undefined>((resolve) => {
      const file = createFile();
      file.onReady = (info) => {
        const track = info.videoTracks[0];
        if (!track || !isAllowedCodecString(track.codec)) {
          resolve(undefined);
          return;
        }
        const description = getSampleEntryDescription(file, track.id);
        resolve(description ? { codec: track.codec, description } : { codec: track.codec });
      };
      file.onError = () => resolve(undefined);
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0));
      file.flush();
    });
    if (resolved) return resolved;
  } catch {
    // Network/parse failure during the probe: fall through to the default.
  }
  return { codec: DEFAULT_LEVEL_CODEC_STRING[codecKind] };
}

export async function isVideoDecoderConfigSupported(
  codec: string,
  width: number,
  height: number,
  description?: Uint8Array,
): Promise<boolean> {
  if (!isAllowedCodecString(codec)) return false;
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const support = await VideoDecoder.isConfigSupported(
      description
        ? { codec, codedWidth: width, codedHeight: height, description }
        : { codec, codedWidth: width, codedHeight: height },
    );
    return support.supported === true;
  } catch {
    return false;
  }
}

export function canPlayTypeSupported(codec: string): boolean {
  if (!isAllowedCodecString(codec)) return false;
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('video');
  return probe.canPlayType(`video/mp4; codecs="${codec}"`) !== '';
}
