import { describe, expect, it } from 'vitest';
import { validateManifest, ManifestValidationError, resolveUrl } from './index.js';
import type { Manifest } from './index.js';

function validFixture(): Manifest {
  return {
    version: 1,
    generator: 'understudy-cli@0.1.0',
    source: { name: 'Avocado', license: 'CC0-1.0' },
    bounds: { center: [0, 0, 0], radius: 1 },
    stage: {
      fovDeg: 35,
      distance: 3.2,
      target: [0, 0, 0],
      environment: 'studio-neutral',
      exposure: 1,
      toneMapping: 'aces',
    },
    proxy: {
      frames: 72,
      rings: [{ elevationDeg: 20 }],
      azimuthStartDeg: 0,
      fps: 24,
      background: '#ffffff',
      variants: [
        {
          kind: 'video',
          codec: 'av01',
          container: 'mp4',
          url: 'proxy-1024.av1.mp4',
          width: 1024,
          height: 1024,
          bytes: 123_456,
          gop: 8,
          frames: 72,
        },
      ],
    },
    tiers: [
      {
        id: 'L0',
        url: 'model.L0.glb',
        bytes: 50_000,
        triangles: 800,
        maxTextureSize: 256,
        extensions: ['EXT_meshopt_compression', 'KHR_texture_basisu'],
      },
    ],
  };
}

describe('validateManifest', () => {
  it('accepts a valid manifest and returns typed data', () => {
    const manifest = validateManifest(validFixture());
    expect(manifest.proxy.frames).toBe(72);
    expect(manifest.tiers[0]?.id).toBe('L0');
  });

  it.each([
    ['version', { ...validFixture(), version: 2 }],
    ['bounds.radius', { ...validFixture(), bounds: { center: [0, 0, 0], radius: -1 } }],
    ['proxy.variants', { ...validFixture(), proxy: { ...validFixture().proxy, variants: [] } }],
    ['tiers', { ...validFixture(), tiers: [] }],
  ])('rejects an invalid manifest (%s) with a readable path', (_label, broken) => {
    try {
      validateManifest(broken);
      expect.unreachable('expected validateManifest to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestValidationError);
      const err = error as ManifestValidationError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.message).toContain('Invalid understudy manifest');
    }
  });

  it('fails with every missing required field reported, not just the first', () => {
    const broken = { version: 1 };
    try {
      validateManifest(broken);
      expect.unreachable('expected validateManifest to throw');
    } catch (error) {
      const err = error as ManifestValidationError;
      const paths = err.issues.map((i) => i.path);
      expect(paths).toContain('generator');
      expect(paths).toContain('bounds');
      expect(paths).toContain('stage');
      expect(paths).toContain('proxy');
      expect(paths).toContain('tiers');
    }
  });
});

describe('resolveUrl', () => {
  it('resolves a relative tier url against the manifest url', () => {
    expect(resolveUrl('https://example.com/models/foo/understudy.json', 'model.L0.glb')).toBe(
      'https://example.com/models/foo/model.L0.glb',
    );
  });

  it('resolves a sequence pattern placeholder literally', () => {
    expect(
      resolveUrl('https://example.com/models/foo/understudy.json', 'frames-512/{i}.avif'),
    ).toBe('https://example.com/models/foo/frames-512/%7Bi%7D.avif');
  });
});
