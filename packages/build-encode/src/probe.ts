import { resolveFfprobePath, runProcess } from './ffmpeg-process.js';

export interface ProbedStream {
  codec_name?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
}

interface StreamsJson<T> {
  streams?: T[];
}

export async function probeVideoStream(file: string): Promise<ProbedStream> {
  const { stdout } = await runProcess(resolveFfprobePath(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,nb_frames',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as StreamsJson<ProbedStream>;
  const stream = parsed.streams?.[0];
  if (!stream) {
    throw new Error(`ffprobe: no video stream found in "${file}"`);
  }
  return stream;
}

/** Fallback for ffmpeg/ffprobe builds that omit nb_frames for a given container. */
export async function countPackets(file: string): Promise<number> {
  const { stdout } = await runProcess(resolveFfprobePath(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_packets',
    '-show_entries',
    'stream=nb_read_packets',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as StreamsJson<{ nb_read_packets?: string }>;
  const value = parsed.streams?.[0]?.nb_read_packets;
  return value ? Number(value) : NaN;
}

export async function probeKeyframeIndices(file: string): Promise<number[]> {
  const { stdout } = await runProcess(resolveFfprobePath(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_frames',
    '-show_entries',
    'frame=key_frame',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as { frames?: { key_frame?: number }[] };
  const frames = parsed.frames ?? [];
  const indices: number[] = [];
  frames.forEach((frame, index) => {
    if (frame.key_frame === 1) indices.push(index);
  });
  return indices;
}

export interface VerifyVideoOptions {
  file: string;
  expectedCodec: 'av1' | 'vp9';
  width: number;
  height: number;
  expectedFrames: number;
}

/** Throws on any mismatch, per the brief: codec, dimensions, and exact frame count. */
export async function verifyEncodedVideo(opts: VerifyVideoOptions): Promise<void> {
  const stream = await probeVideoStream(opts.file);
  const codec = (stream.codec_name ?? '').toLowerCase();
  if (codec !== opts.expectedCodec) {
    throw new Error(
      `encodeProxy: "${opts.file}" has codec "${codec}", expected "${opts.expectedCodec}"`,
    );
  }
  if (stream.width !== opts.width || stream.height !== opts.height) {
    throw new Error(
      `encodeProxy: "${opts.file}" is ${stream.width}x${stream.height}, expected ${opts.width}x${opts.height}`,
    );
  }

  let frameCount = stream.nb_frames !== undefined ? Number(stream.nb_frames) : NaN;
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    frameCount = await countPackets(opts.file);
  }
  if (frameCount !== opts.expectedFrames) {
    throw new Error(
      `encodeProxy: "${opts.file}" has ${frameCount} frames, expected ${opts.expectedFrames}`,
    );
  }
}
