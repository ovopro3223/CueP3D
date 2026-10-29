import path from 'node:path';
import { runFfmpeg } from './ffmpeg-process.js';
import type { Av1EncoderChoice } from './types.js';

function inputArgs(framesDir: string, pattern: string, fps: number): string[] {
  return ['-framerate', String(fps), '-start_number', '0', '-i', path.join(framesDir, pattern)];
}

function scaleArgs(size: number): string[] {
  return ['-vf', `scale=${size}:${size}:flags=lanczos`];
}

export interface EncodeAv1Options {
  framesDir: string;
  pattern: string;
  fps: number;
  size: number;
  gop: number;
  crf: number;
  encoder: Av1EncoderChoice;
  outFile: string;
}

/** Exact per-encoder flags from the brief (docs/briefs/P3-build-encode.md). */
export async function encodeAv1(opts: EncodeAv1Options): Promise<void> {
  const args = [...inputArgs(opts.framesDir, opts.pattern, opts.fps), ...scaleArgs(opts.size)];

  if (opts.encoder === 'svt-av1') {
    args.push(
      '-c:v',
      'libsvtav1',
      '-preset',
      '6',
      '-crf',
      String(opts.crf + 2),
      '-g',
      String(opts.gop),
    );
  } else if (opts.encoder === 'nvenc') {
    args.push(
      '-c:v',
      'av1_nvenc',
      '-cq',
      String(opts.crf),
      '-g',
      String(opts.gop),
      '-preset',
      'p5',
    );
  } else {
    args.push(
      '-c:v',
      'libaom-av1',
      '-crf',
      String(opts.crf),
      '-b:v',
      '0',
      '-cpu-used',
      '6',
      '-row-mt',
      '1',
      '-g',
      String(opts.gop),
      '-keyint_min',
      String(opts.gop),
    );
  }

  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', opts.outFile);
  await runFfmpeg(args);
}

export interface EncodeVp9Options {
  framesDir: string;
  pattern: string;
  fps: number;
  size: number;
  gop: number;
  crf: number;
  outFile: string;
}

export async function encodeVp9(opts: EncodeVp9Options): Promise<void> {
  const args = [
    ...inputArgs(opts.framesDir, opts.pattern, opts.fps),
    ...scaleArgs(opts.size),
    '-c:v',
    'libvpx-vp9',
    '-crf',
    String(opts.crf),
    '-b:v',
    '0',
    '-g',
    String(opts.gop),
    '-row-mt',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    opts.outFile,
  ];
  await runFfmpeg(args);
}
