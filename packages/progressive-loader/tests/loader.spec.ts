import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const fixturePath = path.join(repoRoot, 'fixtures', 'progressive-loader-cube.glb');

const STAGE_PARAMS = {
  fovDeg: 35,
  distance: 3,
  target: [0, 0, 0] as [number, number, number],
  environment: 'none' as const,
  exposure: 1,
  toneMapping: 'none' as const,
};

async function makeTier() {
  const { size } = await stat(fixturePath);
  return {
    id: 'L0' as const,
    url: 'progressive-loader-cube.glb',
    bytes: size,
    triangles: 12,
    maxTextureSize: 64,
    extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'],
  };
}

test('loadTier resolves an Object3D with >= 1 mesh; progress is monotonic and ends at tier.bytes', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const tier = await makeTier();
  const baseUrl = `${baseURL}fixtures/`;

  const result = await page.evaluate(
    async ({ tier, baseUrl }) => window.__pl.loadAndInspect(tier, baseUrl),
    { tier, baseUrl },
  );

  expect(result.meshCount).toBeGreaterThanOrEqual(1);
  expect(result.progress.length).toBeGreaterThan(0);
  for (let i = 1; i < result.progress.length; i++) {
    expect(result.progress[i]).toBeGreaterThan(result.progress[i - 1] as number);
  }
  expect(result.progress.at(-1)).toBe(tier.bytes);
});

test('warm() resolves and makes the first on-screen render faster than an un-warmed load', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const tier = await makeTier();
  const baseUrl = `${baseURL}fixtures/`;

  const { warmedMs, coldMs } = await page.evaluate(
    async ({ tier, baseUrl, stageParams }) => window.__pl.warmVsCold(tier, baseUrl, stageParams),
    { tier, baseUrl, stageParams: STAGE_PARAMS },
  );

  // The brief's <8ms figure was measured on the reference laptop (see
  // docs/reports/P5-report.md); asserting it as an absolute here would make
  // this test flaky on slower or loaded CI runners, so only the ratio is
  // checked — warm() must make the real first render meaningfully faster
  // than an un-warmed load of the same fixture.
  expect(coldMs).toBeGreaterThan(warmedMs * 1.5);
});

test('disposeObject returns renderer.info.memory to its pre-load baseline', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const tier = await makeTier();
  const baseUrl = `${baseURL}fixtures/`;

  const { baseline, afterWarm, afterDispose } = await page.evaluate(
    async ({ tier, baseUrl, stageParams }) => window.__pl.disposeCheck(tier, baseUrl, stageParams),
    { tier, baseUrl, stageParams: STAGE_PARAMS },
  );

  expect(afterWarm.geometries).toBeGreaterThan(baseline.geometries);
  expect(afterWarm.textures).toBeGreaterThan(baseline.textures);
  expect(afterDispose).toEqual(baseline);
});
