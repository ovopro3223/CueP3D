import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';
import { toEmulateNetworkConditions, NETWORK_PRESETS } from '../presets.js';
import { startDemoServer, REPO_ROOT } from '../server.js';

declare global {
  interface Window {
    __cuep3dState?: string;
  }
}

const PORT = 4592;
const VIEWPORT = { width: 820, height: 1200 };
const MODEL_SLUG = 'avocado';
// Measured in BENCHMARKS.md: wifi settles in ~4.6-5.1s for Avocado — short
// enough for a README clip while still showing real proxy-to-live-to-
// settled progression. 4g (~12.5s) and 3g-fast (~64s) are both real
// measurements worth having, just too long for a "short run" demo clip.
const GIF_PRESET = NETWORK_PRESETS.find((p) => p.id === 'wifi');
const SETTLE_TIMEOUT_MS = 20_000;
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'media', 'demo.gif');

const LOADING_STATES = new Set(['idle', 'proxy-loading']);

function resolveFfmpegPath(): string {
  const override = process.env.FFMPEG_PATH;
  return override && override.trim().length > 0 ? override : 'ffmpeg';
}

// Waits past 'proxy-loading' so the drag below lands on a frame that's
// actually visible — BENCHMARKS.md's "Wall TTFV" shows real TTFV is
// network-RTT-dominated, not instant, so a fixed short delay risked
// scrubbing a still-blank canvas (seen on a first recorded take).
async function waitForVisible(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    (loadingStates) => {
      const state = window.__cuep3dState;
      return state !== undefined && !loadingStates.includes(state);
    },
    [...LOADING_STATES],
    { timeout: timeoutMs, polling: 50 },
  );
}

async function waitForSettled(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => window.__cuep3dState === 'settled', undefined, {
    timeout: timeoutMs,
    polling: 100,
  });
}

async function main(): Promise<void> {
  if (!GIF_PRESET) throw new Error('bench: 4g preset not found');

  const server = await startDemoServer(PORT);
  const videoDir = mkdtempSync(path.join(tmpdir(), 'cuep3d-gif-'));
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });

  let videoPath: string;
  let crop: { x: number; y: number; width: number; height: number };

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', toEmulateNetworkConditions(GIF_PRESET));

    const url = new URL(server.baseUrl);
    url.searchParams.set('model', MODEL_SLUG);
    url.searchParams.set('mode', 'cuep3d');
    url.searchParams.set('debug', '1');
    console.log(`[gif] loading ${url.toString()} at ${GIF_PRESET.label}...`);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

    const pane = page.locator('#cuep3d-viewport');
    await pane.scrollIntoViewIfNeeded();
    const box = await pane.boundingBox();
    if (!box) throw new Error('bench: could not measure #cuep3d-viewport bounding box');
    crop = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };

    console.log('[gif] waiting for the proxy to become visible before scrubbing...');
    await waitForVisible(page, 10_000);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // One continuous drag, left to right, with no return to center — the
    // GIF should show a persistent rotation, not a snap back to the start.
    // azimuthDeltaForPointerDelta (packages/viewer/src/scrub.ts) maps a full
    // canvas-height drag to a full turn, so 0.1 * width here is ~35 degrees
    // — enough to be visible without rotating the model out of view.
    await page.mouse.move(cx - box.width * 0.1, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.1, cy, { steps: 20 });
    await page.mouse.up();
    console.log('[gif] scrub performed, waiting for settled...');

    await waitForSettled(page, SETTLE_TIMEOUT_MS);
    await page.waitForTimeout(500);

    const video = page.video();
    if (!video) throw new Error('bench: page has no recorded video (recordVideo not active)');
    await context.close();
    videoPath = await video.path();
  } finally {
    await browser.close();
    await server.stop();
  }

  console.log(`[gif] recorded ${videoPath}, converting to GIF...`);
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const ffmpeg = resolveFfmpegPath();
  const cropFilter = `crop=${String(crop.width)}:${String(crop.height)}:${String(crop.x)}:${String(crop.y)}`;
  const palettePath = path.join(videoDir, 'palette.png');

  execFileSync(
    ffmpeg,
    [
      '-y',
      '-i',
      videoPath,
      '-vf',
      `${cropFilter},fps=12,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff`,
      palettePath,
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      palettePath,
      '-lavfi',
      `${cropFilter},fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`,
      OUTPUT_PATH,
    ],
    { stdio: 'inherit' },
  );

  rmSync(videoDir, { recursive: true, force: true });
  console.log(`[gif] wrote ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
