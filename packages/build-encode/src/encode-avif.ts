import os from 'node:os';
import path from 'node:path';
import { COLOR_METADATA_ARGS, SCALE_COLOR_OPTS, SETPARAMS_COLOR_FILTER } from './color.js';
import { runFfmpeg } from './ffmpeg-process.js';

export interface EncodeAvifSequenceOptions {
  framesDir: string;
  files: string[];
  outDir: string;
  size: number;
  crf: number;
  concurrency?: number;
}

async function encodeOneAvif(
  framesDir: string,
  file: string,
  outDir: string,
  size: number,
  crf: number,
): Promise<void> {
  const index = path.basename(file, '.png');
  const outFile = path.join(outDir, `${index}.avif`);
  await runFfmpeg([
    '-i',
    path.join(framesDir, file),
    '-vf',
    `scale=${size}:${size}:flags=lanczos:${SCALE_COLOR_OPTS},${SETPARAMS_COLOR_FILTER}`,
    '-c:v',
    'libaom-av1',
    '-still-picture',
    '1',
    '-crf',
    String(crf),
    '-cpu-used',
    '6',
    '-pix_fmt',
    'yuv420p',
    ...COLOR_METADATA_ARGS,
    outFile,
  ]);
}

/**
 * No avifenc on PATH in this environment, so stills are produced with
 * ffmpeg's own libaom-av1 still-picture mode (same quality intent the brief
 * asks avifenc for). Each frame is its own ffmpeg process, so a bounded
 * worker pool (default os.cpus().length) is the concurrency control.
 */
export async function encodeAvifSequence(opts: EncodeAvifSequenceOptions): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? os.cpus().length);
  const queue = [...opts.files];

  async function worker(): Promise<void> {
    for (;;) {
      const file = queue.shift();
      if (file === undefined) return;
      await encodeOneAvif(opts.framesDir, file, opts.outDir, opts.size, opts.crf);
    }
  }

  const workerCount = Math.min(concurrency, opts.files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
