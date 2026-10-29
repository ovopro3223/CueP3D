import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { StageParams } from '@cuep3d/manifest';
import { azimuthForFrameIndex, degToRad, fitDistance, radToDeg } from '@cuep3d/stage';
import { startStaticServer } from './static-server.js';

export interface RenderProxyFramesOptions {
  /** The L2 tier .glb (or model.norm.glb) from P1 — a local file path, or an http(s) URL. */
  modelUrlOrPath: string;
  /** Writes <outDir>/frames/NNN.png and <outDir>/camera.json. */
  outDir: string;
  /** Square render size, the largest proxy size (1024). */
  size: number;
  /** Frames per ring (72). */
  frames: number;
  /** Elevation of each ring, in degrees ([20] for v1's single ring). */
  ringsDeg: number[];
  azimuthStartDeg: number;
  /** distance is computed from bounds via fitDistance, not supplied here. */
  stage: Omit<StageParams, 'distance'>;
  background: string;
  bounds: { center: [number, number, number]; radius: number };
  /** Escape hatch for local, non-deterministic runs; default is SwiftShader. */
  useGpu?: boolean;
  onProgress?: (renderedFrames: number, totalFrames: number) => void;
}

export interface RenderProxyFramesResult {
  framesDir: string;
  cameraJson: string;
  stage: StageParams;
}

interface PerFrameEntry {
  i: number;
  azimuthDeg: number;
  elevationDeg: number;
}

interface CameraJson {
  stage: StageParams;
  frames: number;
  ringsDeg: number[];
  azimuthStartDeg: number;
  perFrame: PerFrameEntry[];
}

const SWIFTSHADER_ARGS = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
];
const PAGE_READY_TIMEOUT_MS = 30_000;

function frameFileName(index: number, totalFrames: number): string {
  const digits = Math.max(3, String(totalFrames - 1).length);
  return `${String(index).padStart(digits, '0')}.png`;
}

async function loadModelBytes(modelUrlOrPath: string): Promise<Uint8Array> {
  if (/^https?:\/\//.test(modelUrlOrPath)) {
    const res = await fetch(modelUrlOrPath);
    if (!res.ok)
      throw new Error(`failed to fetch model ${modelUrlOrPath}: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return readFile(path.resolve(modelUrlOrPath));
}

async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__cuep3dPageReady === true || typeof window.__cuep3dPageError === 'string',
    { timeout: PAGE_READY_TIMEOUT_MS },
  );
  const pageError = await page.evaluate(() => window.__cuep3dPageError);
  if (pageError) throw new Error(`render page failed to initialize: ${pageError}`);
}

async function loadModel(page: Page, modelUrl: string): Promise<void> {
  await page.evaluate(async (url) => {
    await window.__cuep3dRender?.load(url);
  }, modelUrl);
}

async function snapshotFrame(
  page: Page,
  azimuthRad: number,
  elevationRad: number,
): Promise<Buffer> {
  await page.evaluate((az, el) => window.__cuep3dRender?.setView(az, el), azimuthRad, elevationRad);
  const base64Png = await page.evaluate(async () => {
    const render = window.__cuep3dRender;
    if (!render) throw new Error('window.__cuep3dRender missing');
    return render.snapshot();
  });
  return Buffer.from(base64Png, 'base64');
}

/**
 * Renders the proxy orbit-video source frames for `modelUrlOrPath` in
 * headless Chromium, using @cuep3d/stage so build-time frames and the
 * live viewer agree pixel-for-pixel (D-007). See docs/briefs/P2-build-proxy.md.
 */
export async function renderProxyFrames(
  opts: RenderProxyFramesOptions,
): Promise<RenderProxyFramesResult> {
  if (opts.ringsDeg.length === 0) throw new Error('ringsDeg must contain at least one ring');
  if (opts.frames <= 0) throw new Error('frames must be positive');
  if (opts.size <= 0) throw new Error('size must be positive');

  const distance = fitDistance(opts.bounds.radius, opts.stage.fovDeg);
  const stageParams: StageParams = { ...opts.stage, distance };

  const framesDir = path.join(opts.outDir, 'frames');
  await mkdir(framesDir, { recursive: true });

  const modelBytes = await loadModelBytes(opts.modelUrlOrPath);
  const server = await startStaticServer({ modelBytes });

  const totalFrames = opts.frames * opts.ringsDeg.length;
  const launchArgs = opts.useGpu ? [] : SWIFTSHADER_ARGS;

  let browser: Browser | undefined;
  const perFrame: PerFrameEntry[] = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [...launchArgs, '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: opts.size, height: opts.size, deviceScaleFactor: 1 });

    const stageQuery = encodeURIComponent(
      Buffer.from(JSON.stringify(stageParams)).toString('base64'),
    );
    const backgroundQuery = encodeURIComponent(opts.background);
    const pageUrl =
      `${server.baseUrl}/render-page.html?size=${opts.size}` +
      `&stage=${stageQuery}&background=${backgroundQuery}`;

    await page.goto(pageUrl, { waitUntil: 'load' });
    await waitForPageReady(page);
    await loadModel(page, `${server.baseUrl}/model.glb`);

    const azimuthStartRad = degToRad(opts.azimuthStartDeg);
    let rendered = 0;

    for (let ring = 0; ring < opts.ringsDeg.length; ring++) {
      const elevationDeg = opts.ringsDeg[ring] ?? 0;
      const elevationRad = degToRad(elevationDeg);

      for (let i = 0; i < opts.frames; i++) {
        const globalIndex = ring * opts.frames + i;
        const azimuthRad = azimuthForFrameIndex(i, opts.frames, azimuthStartRad);

        const pngBuffer = await snapshotFrame(page, azimuthRad, elevationRad);
        await writeFile(path.join(framesDir, frameFileName(globalIndex, totalFrames)), pngBuffer);

        perFrame.push({ i: globalIndex, azimuthDeg: radToDeg(azimuthRad), elevationDeg });

        rendered++;
        opts.onProgress?.(rendered, totalFrames);
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  const cameraJson: CameraJson = {
    stage: stageParams,
    frames: opts.frames,
    ringsDeg: opts.ringsDeg,
    azimuthStartDeg: opts.azimuthStartDeg,
    perFrame,
  };
  const cameraJsonPath = path.join(opts.outDir, 'camera.json');
  await writeFile(cameraJsonPath, JSON.stringify(cameraJson, null, 2));

  return { framesDir, cameraJson: cameraJsonPath, stage: stageParams };
}
