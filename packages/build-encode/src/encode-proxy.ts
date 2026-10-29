import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProxyVariant } from '@understudy3d/manifest';
import { encodeAvifSequence } from './encode-avif.js';
import { encodeAv1, encodeVp9 } from './encode-video.js';
import { readFrameSequence } from './frames.js';
import { probeVideoStream, verifyEncodedVideo } from './probe.js';
import { selectAv1Encoder } from './select-encoder.js';
import { DEFAULT_QUALITY, type EncodeProxyOptions } from './types.js';

/**
 * Turns a "NNN.png" frame sequence into the manifest's ProxyVariant[]:
 * AV1 at every requested size (largest first), VP9 and an AVIF still
 * sequence at the smallest size only. Every produced file is ffprobe-
 * verified (codec, dimensions, frame count) before its variant is returned.
 */
export async function encodeProxy(opts: EncodeProxyOptions): Promise<ProxyVariant[]> {
  if (opts.sizes.length === 0) {
    throw new Error('encodeProxy: opts.sizes must be non-empty');
  }

  const sizesDesc = [...new Set(opts.sizes)].sort((a, b) => b - a);
  const minSize = sizesDesc[sizesDesc.length - 1]!;
  const quality = { ...DEFAULT_QUALITY, ...opts.quality };

  const sequence = await readFrameSequence(opts.framesDir);
  await mkdir(opts.outDir, { recursive: true });

  const selected = await selectAv1Encoder(opts.encoder, minSize);
  console.log(`build-encode: AV1 encoder = ${selected.choice}`);

  const variants: ProxyVariant[] = [];

  for (const size of sizesDesc) {
    const outFile = path.join(opts.outDir, `proxy-${size}.av1.mp4`);
    await encodeAv1({
      framesDir: opts.framesDir,
      pattern: sequence.pattern,
      fps: opts.fps,
      size,
      gop: opts.gop,
      crf: quality.av1Crf,
      encoder: selected.choice,
      outFile,
    });
    await verifyEncodedVideo({
      file: outFile,
      expectedCodec: 'av1',
      width: size,
      height: size,
      expectedFrames: sequence.count,
    });
    variants.push({
      kind: 'video',
      codec: 'av01',
      container: 'mp4',
      url: path.basename(outFile),
      width: size,
      height: size,
      bytes: (await stat(outFile)).size,
      gop: opts.gop,
    });
  }

  {
    const outFile = path.join(opts.outDir, `proxy-${minSize}.vp9.mp4`);
    await encodeVp9({
      framesDir: opts.framesDir,
      pattern: sequence.pattern,
      fps: opts.fps,
      size: minSize,
      gop: opts.gop,
      crf: quality.vp9Crf,
      outFile,
    });
    await verifyEncodedVideo({
      file: outFile,
      expectedCodec: 'vp9',
      width: minSize,
      height: minSize,
      expectedFrames: sequence.count,
    });
    variants.push({
      kind: 'video',
      codec: 'vp09',
      container: 'mp4',
      url: path.basename(outFile),
      width: minSize,
      height: minSize,
      bytes: (await stat(outFile)).size,
      gop: opts.gop,
    });
  }

  {
    const seqDirName = `frames-${minSize}`;
    const seqDir = path.join(opts.outDir, seqDirName);
    await mkdir(seqDir, { recursive: true });
    await encodeAvifSequence({
      framesDir: opts.framesDir,
      files: sequence.files,
      outDir: seqDir,
      size: minSize,
      crf: quality.avifCrf,
    });

    let totalBytes = 0;
    for (const file of sequence.files) {
      const index = path.basename(file, '.png');
      const avifFile = path.join(seqDir, `${index}.avif`);
      const stream = await probeVideoStream(avifFile);
      const codec = (stream.codec_name ?? '').toLowerCase();
      if (codec !== 'av1') {
        throw new Error(`encodeProxy: "${avifFile}" has codec "${codec}", expected "av1"`);
      }
      if (stream.width !== minSize || stream.height !== minSize) {
        throw new Error(
          `encodeProxy: "${avifFile}" is ${stream.width}x${stream.height}, expected ${minSize}x${minSize}`,
        );
      }
      totalBytes += (await stat(avifFile)).size;
    }

    variants.push({
      kind: 'image-sequence',
      codec: 'avif',
      url: `${seqDirName}/{i}.avif`,
      width: minSize,
      height: minSize,
      bytes: totalBytes,
    });
  }

  return variants;
}
