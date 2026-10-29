import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '@understudy3d/manifest';
import { runBuild } from './build-command.js';

const execFileAsync = promisify(execFile);

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function isToktxAvailable(): Promise<boolean> {
  try {
    await execFileAsync('toktx', ['--version']);
    return true;
  } catch (error) {
    return !isEnoent(error);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const samplePath = path.join(repoRoot, 'samples', 'Avocado.glb');

const toktxAvailable = await isToktxAvailable();
const sampleAvailable = await stat(samplePath)
  .then(() => true)
  .catch(() => false);

describe.skipIf(!toktxAvailable || !sampleAvailable)(
  'runBuild end-to-end (requires toktx + `pnpm run fetch-samples`)',
  () => {
    it('builds a complete, schema-valid understudy bundle from a real .glb', async () => {
      const outDir = await mkdtemp(path.join(tmpdir(), 'understudy-cli-test-'));
      try {
        await runBuild({
          input: samplePath,
          outDir,
          frames: 8,
          ringsDeg: [20],
          proxySizes: [256],
          environment: 'studio-neutral',
          background: '#ffffff',
          encoder: 'auto',
        });

        const manifestJson = JSON.parse(
          await readFile(path.join(outDir, 'understudy.json'), 'utf8'),
        );
        const manifest = validateManifest(manifestJson);

        expect(manifest.tiers.map((t) => t.id)).toEqual(['L0', 'L1', 'L2']);
        expect(manifest.proxy.frames).toBe(8);
        // AV1 (one size) + VP9 + AVIF, per D-004's fallback chain.
        expect(manifest.proxy.variants.map((v) => v.codec).sort()).toEqual([
          'av01',
          'avif',
          'vp09',
        ]);

        for (const tier of manifest.tiers) {
          await expect(stat(path.join(outDir, tier.url))).resolves.toBeDefined();
        }
        for (const variant of manifest.proxy.variants) {
          const samplePathForVariant =
            variant.kind === 'video' ? variant.url : variant.url.replace('{i}', '000');
          await expect(
            stat(path.join(outDir, samplePathForVariant)),
            `expected "${samplePathForVariant}" to exist for ${variant.kind}/${variant.codec}`,
          ).resolves.toBeDefined();
        }
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    }, 120_000);
  },
);
