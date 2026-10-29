/**
 * Explicit colour metadata for every proxy variant (D-012).
 *
 * The source frames are sRGB renders. Without these flags ffmpeg converts
 * RGB -> YUV with a BT.601 matrix and writes no colour config at all, so
 * every decode path guesses. Measured on the P4 fixture against its own
 * ground-truth PNG: a decoder that knows the matrix reads 0.57% mean abs
 * diff (the actual AV1 compression noise); one assuming BT.709 reads 3.2%,
 * one assuming full range 5.7%. That guessing is the whole "~4% AV1 floor"
 * docs/change-requests/P6-av1-color-metadata.md could not isolate on the
 * owner's machine, and ~8% on Linux CI where WebCodecs guesses differently
 * from the <video> element. Converting with BT.709 and tagging matrix,
 * primaries, transfer and range removes the guess on both sides.
 */
export const COLOR_MATRIX = 'bt709';
export const COLOR_RANGE = 'tv';

/** `scale` filter options that make swscale use the matrix the stream is tagged with. */
export const SCALE_COLOR_OPTS = `out_color_matrix=${COLOR_MATRIX}:out_range=${COLOR_RANGE}`;

/**
 * Appended to the filter chain after `scale`. ffmpeg 8's encoders take
 * primaries/transfer from the frames, not from the `-color_primaries` /
 * `-color_trc` options (verified: libaom, libvpx-vp9 and av1_nvenc all
 * wrote "unknown" for both with the options alone, and all four fields with
 * this filter), so stamp them onto the frames themselves.
 */
export const SETPARAMS_COLOR_FILTER = `setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=${COLOR_MATRIX}:range=${COLOR_RANGE}`;

/** Output-side ffmpeg flags, kept as well for encoders that read the codec context. */
export const COLOR_METADATA_ARGS = [
  '-colorspace',
  COLOR_MATRIX,
  '-color_primaries',
  'bt709',
  '-color_trc',
  'iec61966-2-1',
  '-color_range',
  COLOR_RANGE,
];
