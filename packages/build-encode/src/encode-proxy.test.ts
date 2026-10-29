import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProxyVariantSchema } from '@cuep3d/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeProxy } from './encode-proxy.js';
import { probeKeyframeIndices, probeVideoStream } from './probe.js';
import { generateFixtureFrames } from './test-support/fixture-frames.js';

const FRAMES = 72;
const FPS = 24;
const GOP = 8;
const SIZES = [1024, 512];

describe('encodeProxy (full pipeline, libaom — deterministic across machines/CI)', () => {
  let framesDir: string;
  let outDir: string;
  let variants: Awaited<ReturnType<typeof encodeProxy>>;

  beforeAll(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'build-encode-proxy-'));
    framesDir = path.join(root, 'frames');
    outDir = path.join(root, 'out');
    await generateFixtureFrames({
      dir: framesDir,
      frames: FRAMES,
      size: Math.max(...SIZES),
      fps: FPS,
    });
    variants = await encodeProxy({
      framesDir,
      outDir,
      sizes: SIZES,
      fps: FPS,
      gop: GOP,
      encoder: 'libaom',
    });
  }, 120_000);

  afterAll(async () => {
    await rm(path.dirname(framesDir), { recursive: true, force: true });
  });

  it('returns variants ordered AV1 (largest -> smallest), VP9, AVIF', () => {
    expect(variants.map((v) => `${v.codec}@${v.width}`)).toEqual([
      'av01@1024',
      'av01@512',
      'vp09@512',
      'avif@512',
    ]);
  });

  it('every variant validates against the manifest ProxyVariant schema', () => {
    for (const variant of variants) {
      expect(() => ProxyVariantSchema.parse(variant)).not.toThrow();
    }
  });

  it('writes the expected files with +faststart mp4s and a named AVIF sequence dir', async () => {
    await expect(stat(path.join(outDir, 'proxy-1024.av1.mp4'))).resolves.toBeDefined();
    await expect(stat(path.join(outDir, 'proxy-512.av1.mp4'))).resolves.toBeDefined();
    await expect(stat(path.join(outDir, 'proxy-512.vp9.mp4'))).resolves.toBeDefined();
    const avifFiles = (await readdir(path.join(outDir, 'frames-512'))).sort();
    expect(avifFiles).toHaveLength(FRAMES);
    expect(avifFiles[0]).toBe('000.avif');
    expect(avifFiles[FRAMES - 1]).toBe('071.avif');
  });

  it("stays within the brief's size budgets", () => {
    const byKey = new Map(variants.map((v) => [`${v.codec}@${v.width}`, v]));
    expect(byKey.get('av01@512')!.bytes).toBeLessThanOrEqual(600 * 1024);
    expect(byKey.get('av01@1024')!.bytes).toBeLessThanOrEqual(1.6 * 1024 * 1024);
    expect(byKey.get('vp09@512')!.bytes).toBeLessThanOrEqual(900 * 1024);
    expect(byKey.get('avif@512')!.bytes).toBeLessThanOrEqual(1.2 * 1024 * 1024);
  });

  it('places keyframes at exactly i % 8 === 0 in both mp4 variants', async () => {
    const av1Keyframes = await probeKeyframeIndices(path.join(outDir, 'proxy-1024.av1.mp4'));
    const vp9Keyframes = await probeKeyframeIndices(path.join(outDir, 'proxy-512.vp9.mp4'));
    const expected = Array.from({ length: Math.ceil(FRAMES / GOP) }, (_, i) => i * GOP);
    expect(av1Keyframes).toEqual(expected);
    expect(vp9Keyframes).toEqual(expected);
  });

  it('tags every variant with explicit colour metadata (D-012), so no decoder has to guess the matrix or range', async () => {
    for (const file of ['proxy-1024.av1.mp4', 'proxy-512.vp9.mp4', 'frames-512/000.avif']) {
      const stream = await probeVideoStream(path.join(outDir, file));
      expect(stream, file).toMatchObject({
        color_space: 'bt709',
        color_primaries: 'bt709',
        color_transfer: 'iec61966-2-1',
        color_range: 'tv',
      });
    }
  });

  it('url for the AVIF sequence carries the {i} placeholder, not a resolved index', () => {
    const avifVariant = variants.find((v) => v.codec === 'avif')!;
    expect(avifVariant.url).toBe('frames-512/{i}.avif');
    expect(avifVariant.kind).toBe('image-sequence');
    expect(avifVariant.gop).toBeUndefined();
  });

  it('video variants carry gop and container; the image sequence does not carry container', () => {
    for (const variant of variants.filter((v) => v.kind === 'video')) {
      expect(variant.gop).toBe(GOP);
      expect(variant.container).toBe('mp4');
    }
    const avifVariant = variants.find((v) => v.kind === 'image-sequence')!;
    expect(avifVariant.container).toBeUndefined();
  });
});

describe('encodeProxy — rejects malformed inputs before shelling out to ffmpeg', () => {
  it('throws on an empty sizes array', async () => {
    await expect(
      encodeProxy({
        framesDir: os.tmpdir(),
        outDir: os.tmpdir(),
        sizes: [],
        fps: FPS,
        gop: GOP,
        encoder: 'libaom',
      }),
    ).rejects.toThrow(/sizes must be non-empty/);
  });
});

describe('encodeProxy (encoder: "auto") — real environment integration', () => {
  it('succeeds end-to-end and never silently picks an encoder other than one that actually works', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'build-encode-auto-'));
    try {
      const framesDir = path.join(root, 'frames');
      const outDir = path.join(root, 'out');
      await generateFixtureFrames({ dir: framesDir, frames: 16, size: 256, fps: FPS });
      const variants = await encodeProxy({
        framesDir,
        outDir,
        sizes: [256],
        fps: FPS,
        gop: GOP,
        encoder: 'auto',
      });
      expect(variants).toHaveLength(3); // AV1@256, VP9@256, AVIF@256
      const av1 = variants.find((v) => v.codec === 'av01')!;
      const stream = await probeVideoStream(path.join(outDir, path.basename(av1.url)));
      expect(stream.codec_name).toBe('av1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
