import { readdir } from 'node:fs/promises';

export interface FrameSequence {
  /** Sorted basenames, e.g. "000.png", "001.png", ... */
  files: string[];
  count: number;
  padWidth: number;
  /** ffmpeg numbered-sequence pattern, e.g. "%03d.png". */
  pattern: string;
}

const FRAME_NAME = /^(\d+)\.png$/i;

/**
 * Reads and validates the "NNN.png" frame sequence P2 produces: contiguous,
 * zero-indexed, consistently zero-padded. Throws with a specific reason
 * rather than letting ffmpeg fail opaquely on a malformed input directory.
 */
export async function readFrameSequence(framesDir: string): Promise<FrameSequence> {
  let entries: string[];
  try {
    entries = await readdir(framesDir);
  } catch (error) {
    throw new Error(
      `encodeProxy: cannot read framesDir "${framesDir}": ${(error as Error).message}`,
    );
  }

  const files = entries
    .filter((f) => FRAME_NAME.test(f))
    .sort((a, b) => {
      const na = Number(FRAME_NAME.exec(a)?.[1]);
      const nb = Number(FRAME_NAME.exec(b)?.[1]);
      return na - nb;
    });

  if (files.length === 0) {
    throw new Error(`encodeProxy: no "NNN.png" frames found in "${framesDir}"`);
  }

  const first = files[0]!;
  const padWidth = first.length - '.png'.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const match = FRAME_NAME.exec(file)!;
    const digits = match[1]!;
    if (digits.length !== padWidth) {
      throw new Error(
        `encodeProxy: frame "${file}" in "${framesDir}" has inconsistent zero-padding (expected ${padWidth} digits like "${first}")`,
      );
    }
    const index = Number(digits);
    if (index !== i) {
      throw new Error(
        `encodeProxy: frame sequence in "${framesDir}" is not contiguous from 0 — expected frame index ${i}, found "${file}"`,
      );
    }
  }

  return {
    files,
    count: files.length,
    padWidth,
    pattern: `%0${padWidth}d.png`,
  };
}
