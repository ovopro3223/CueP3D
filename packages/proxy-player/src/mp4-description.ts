import { DataStream, Endianness, type ISOFile } from 'mp4box';

/**
 * Extracts the raw decoder-config bytes (the av1C or vpcC box payload,
 * without its 8-byte size+fourcc header) for the given track, for use as
 * VideoDecoderConfig.description. This is the standard mp4box.js technique
 * for bridging ISOBMFF sample-entry config boxes to WebCodecs (the box
 * objects mp4box parses out of stsd each implement write(), which is the
 * only way to get their serialized bytes back out).
 *
 * Only av01/vp09 sample entries are recognized (D-004: AV1 primary, VP9
 * fallback, nothing else) — a file carrying any other video codec is not a
 * variant this package will ever be asked to play.
 */
export function getSampleEntryDescription(file: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries || entries.length === 0) return undefined;
  const entry = entries[0] as unknown as Record<
    string,
    { write(stream: DataStream): void } | undefined
  >;
  const box = entry.av1C ?? entry.vpcC;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  // Box layout is [4-byte size][4-byte fourcc][payload]; write() re-emits both.
  return new Uint8Array(stream.buffer).slice(8);
}
