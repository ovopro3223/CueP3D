import { azimuthForFrameIndex } from '@cuep3d/stage';
import { createViewer } from '../../src/index.js';
import type { Viewer, ViewerOptions } from '../../src/types.js';

interface StatechangeLogEntry {
  type: 'statechange' | 'error' | 'metrics';
  detail: unknown;
  tMs: number;
}

interface Entry {
  container: HTMLDivElement;
  viewer: Viewer;
  log: StatechangeLogEntry[];
}

const viewers = new Map<number, Entry>();
let nextId = 1;

// Tracks outstanding (requested-but-not-yet-fired-or-cancelled) rAF handles
// across the whole page, installed once before any viewer exists, so the
// dispose test can assert the count returns to zero — a continuous render
// loop that outlives dispose() would otherwise be invisible from outside.
const outstandingRaf = new Set<number>();
const realRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const realCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const handle = realRequestAnimationFrame((time) => {
    outstandingRaf.delete(handle);
    callback(time);
  });
  outstandingRaf.add(handle);
  return handle;
};
window.cancelAnimationFrame = (handle: number): void => {
  outstandingRaf.delete(handle);
  realCancelAnimationFrame(handle);
};

function entry(id: number): Entry {
  const found = viewers.get(id);
  if (!found) throw new Error(`No viewer with id ${id}`);
  return found;
}

function create(optionsJson: string): number {
  const options = JSON.parse(optionsJson) as ViewerOptions;
  const container = document.createElement('div');
  container.style.width = '256px';
  container.style.height = '256px';
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  document.body.appendChild(container);

  const viewer = createViewer(container, { ...options, debug: true });
  const log: StatechangeLogEntry[] = [];
  viewer.addEventListener('statechange', (event) => {
    log.push({
      type: 'statechange',
      detail: (event as CustomEvent).detail,
      tMs: performance.now(),
    });
  });
  viewer.addEventListener('error', (event) => {
    log.push({ type: 'error', detail: (event as CustomEvent).detail, tMs: performance.now() });
  });

  const id = nextId++;
  viewers.set(id, { container, viewer, log });
  return id;
}

function getState(id: number): string {
  return entry(id).viewer.state;
}

function getDegraded(id: number): boolean {
  return entry(id).viewer.degraded;
}

function getMetrics(id: number): unknown {
  return entry(id).viewer.metrics;
}

function getStateLog(id: number): string[] {
  return entry(id)
    .log.filter((e) => e.type === 'statechange')
    .map((e) => (e.detail as { state: string }).state);
}

function getFullLog(id: number): StatechangeLogEntry[] {
  return entry(id).log;
}

function getErrorLog(id: number): string[] {
  return entry(id)
    .log.filter((e) => e.type === 'error')
    .map((e) => String((e.detail as { error: Error }).error?.message ?? e.detail));
}

function waitForState(id: number, state: string, timeoutMs: number): Promise<boolean> {
  const e = entry(id);
  if (e.viewer.state === state) return Promise.resolve(true);
  if (e.viewer.state === 'error' && state !== 'error') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      e.viewer.removeEventListener('statechange', onChange);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    function onChange(): void {
      if (e.viewer.state === state) {
        clearTimeout(timer);
        finish(true);
      } else if (e.viewer.state === 'error' && state !== 'error') {
        clearTimeout(timer);
        finish(false);
      }
    }
    e.viewer.addEventListener('statechange', onChange);
  });
}

function getCanvas(id: number): HTMLCanvasElement {
  const canvas = entry(id).container.querySelector('canvas');
  if (!canvas) throw new Error(`Viewer ${id} has no canvas yet`);
  return canvas;
}

function dispatchPointer(
  canvas: HTMLCanvasElement,
  type: string,
  clientX: number,
  clientY: number,
): void {
  canvas.dispatchEvent(
    new PointerEvent(type, { pointerId: 1, clientX, clientY, bubbles: true, cancelable: true }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drags the canvas to land on exactly `targetIndex`, using the same azimuth
 * math production code uses (`azimuthForFrameIndex`), in many small,
 * time-spaced steps so the drag's measured velocity stays under
 * FAST_DRAG_THRESHOLD_PX_PER_MS — a real slow look-around, not a fling —
 * so the handoff wait (capped at 1s) resolves immediately once warm().
 */
async function scrubToFrame(
  id: number,
  targetIndex: number,
  frames: number,
  azimuthStartRad: number,
): Promise<void> {
  const canvas = getCanvas(id);
  const rect = canvas.getBoundingClientRect();
  const h = rect.height;
  const targetAzimuth = azimuthForFrameIndex(targetIndex, frames, azimuthStartRad);
  let deltaTheta = targetAzimuth - azimuthStartRad;
  while (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
  while (deltaTheta <= -Math.PI) deltaTheta += 2 * Math.PI;
  const totalDx = -(deltaTheta * h) / (2 * Math.PI);

  const steps = 15;
  const baseX = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  dispatchPointer(canvas, 'pointerdown', baseX, y);
  for (let i = 1; i <= steps; i++) {
    await sleep(20);
    dispatchPointer(canvas, 'pointermove', baseX + (totalDx * i) / steps, y);
  }
  await sleep(20);
  dispatchPointer(canvas, 'pointerup', baseX + totalDx, y);
}

async function flingDuringDrag(id: number): Promise<void> {
  // 400px over ~30ms ≈ 13 px/ms, far above FAST_DRAG_THRESHOLD_PX_PER_MS
  // (0.3 px/ms) — a real flick, not a careful look-around.
  const canvas = getCanvas(id);
  const rect = canvas.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  dispatchPointer(canvas, 'pointerdown', rect.left, y);
  await sleep(30);
  dispatchPointer(canvas, 'pointermove', rect.left + 400, y);
}

function releasePointer(id: number): void {
  const canvas = getCanvas(id);
  const rect = canvas.getBoundingClientRect();
  dispatchPointer(canvas, 'pointerup', rect.left + 400, rect.top + rect.height / 2);
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = n;
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

interface PixelCapture {
  width: number;
  height: number;
  data: number[];
}

function capturePixels(id: number): PixelCapture {
  const canvas = getCanvas(id);
  const width = canvas.width;
  const height = canvas.height;
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: Array.from(data) };
}

function capturePixelsDataURL(id: number): string {
  const canvas = getCanvas(id);
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(canvas, 0, 0);
  return off.toDataURL('image/png');
}

async function captureAfterFrames(id: number, frames: number): Promise<PixelCapture> {
  await waitFrames(frames);
  return capturePixels(id);
}

interface CaptureResult {
  reached: boolean;
  pixels: PixelCapture | null;
}

/**
 * Like `waitForState`, but captures the canvas INSIDE the 'statechange'
 * listener — the same synchronous call stack `setState()` dispatches the
 * event from — rather than after a round trip back from Node. A
 * `page.evaluate()` round trip takes real wall-clock time, during which
 * the page's own rAF loop keeps ticking independently; across that gap a
 * 150ms crossfade can easily advance several frames, so capturing after
 * the round trip (not inside the listener) silently captures a
 * mid-crossfade blend instead of the intended frame. This is what the
 * handoff pixel-diff test needs for both captures.
 */
function waitForStateAndCapture(
  id: number,
  state: string,
  timeoutMs: number,
): Promise<CaptureResult> {
  const e = entry(id);
  if (e.viewer.state === state)
    return Promise.resolve({ reached: true, pixels: capturePixels(id) });
  if (e.viewer.state === 'error' && state !== 'error') {
    return Promise.resolve({ reached: false, pixels: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reached: boolean): void => {
      if (settled) return;
      settled = true;
      e.viewer.removeEventListener('statechange', onChange);
      resolve({ reached, pixels: reached ? capturePixels(id) : null });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    function onChange(): void {
      if (e.viewer.state === state) {
        clearTimeout(timer);
        finish(true);
      } else if (e.viewer.state === 'error' && state !== 'error') {
        clearTimeout(timer);
        finish(false);
      }
    }
    e.viewer.addEventListener('statechange', onChange);
  });
}

function dispose(id: number): void {
  const e = entry(id);
  e.viewer.dispose();
  e.container.remove();
  viewers.delete(id);
}

function outstandingRafCount(): number {
  return outstandingRaf.size;
}

function rendererMemory(): { geometries: number; textures: number } | null {
  const debug = (window as unknown as Record<string, unknown>).__cuep3dDebug as
    { renderer?: { info: { memory: { geometries: number; textures: number } } } } | undefined;
  if (!debug?.renderer) return null;
  return { ...debug.renderer.info.memory };
}

const longTasks: { startTime: number; duration: number }[] = [];
if (typeof PerformanceObserver !== 'undefined') {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entryItem of list.getEntries()) {
        longTasks.push({ startTime: entryItem.startTime, duration: entryItem.duration });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long Tasks API unsupported — the long-task assertion is skipped by
    // the test itself when this stays empty; nothing else depends on it.
  }
}

function getLongTasksSince(tMs: number): { startTime: number; duration: number }[] {
  return longTasks.filter((t) => t.startTime >= tMs);
}

function waitForStateAndCaptureDataURL(
  id: number,
  state: string,
  timeoutMs: number,
): Promise<string | null> {
  const e = entry(id);
  if (e.viewer.state === state) return Promise.resolve(capturePixelsDataURL(id));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      e.viewer.removeEventListener('statechange', onChange);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    function onChange(): void {
      if (e.viewer.state === state) {
        clearTimeout(timer);
        finish(capturePixelsDataURL(id));
      }
    }
    e.viewer.addEventListener('statechange', onChange);
  });
}

declare global {
  interface Window {
    Harness: {
      create(optionsJson: string): number;
      getState(id: number): string;
      getDegraded(id: number): boolean;
      getMetrics(id: number): unknown;
      getStateLog(id: number): string[];
      getFullLog(id: number): StatechangeLogEntry[];
      getErrorLog(id: number): string[];
      waitForState(id: number, state: string, timeoutMs: number): Promise<boolean>;
      waitForStateAndCapture(id: number, state: string, timeoutMs: number): Promise<CaptureResult>;
      waitForStateAndCaptureDataURL(
        id: number,
        state: string,
        timeoutMs: number,
      ): Promise<string | null>;
      scrubToFrame(
        id: number,
        targetIndex: number,
        frames: number,
        azimuthStartRad: number,
      ): Promise<void>;
      flingDuringDrag(id: number): Promise<void>;
      releasePointer(id: number): void;
      capturePixels(id: number): PixelCapture;
      captureAfterFrames(id: number, frames: number): Promise<PixelCapture>;
      waitFrames(n: number): Promise<void>;
      dispose(id: number): void;
      rendererMemory(): { geometries: number; textures: number } | null;
      outstandingRafCount(): number;
      getLongTasksSince(tMs: number): { startTime: number; duration: number }[];
      now(): number;
    };
  }
}

window.Harness = {
  create,
  getState,
  getDegraded,
  getMetrics,
  getStateLog,
  getFullLog,
  getErrorLog,
  waitForState,
  waitForStateAndCapture,
  waitForStateAndCaptureDataURL,
  scrubToFrame,
  flingDuringDrag,
  releasePointer,
  capturePixels,
  captureAfterFrames,
  waitFrames,
  dispose,
  rendererMemory,
  outstandingRafCount,
  getLongTasksSince,
  now: () => performance.now(),
};
