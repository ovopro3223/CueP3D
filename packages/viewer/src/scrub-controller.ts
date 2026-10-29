import { frameIndexForAzimuth } from '@cuep3d/stage';
import { azimuthDeltaForPointerDelta, isFastDrag, type DragSample } from './scrub.js';

export interface ScrubControllerOptions {
  frames: number;
  azimuthStartRad: number;
  initialAzimuthRad: number;
  onFrameChange: (frameIndex: number, azimuthRad: number) => void;
}

/**
 * Wires pointer (mouse + touch, via the Pointer Events API) drag handling
 * to the §5.1 scrub formula, and tracks recent drag velocity for the
 * handoff rule (§6: never swap mid-fast-drag). Live only during the proxy
 * phase — `detach()` is called before OrbitControls takes over the canvas's
 * pointer events at handoff.
 */
export function createScrubController(canvas: HTMLElement, options: ScrubControllerOptions) {
  let azimuthRad = options.initialAzimuthRad;
  let pointerDown = false;
  let activePointerId: number | null = null;
  let lastX = 0;
  let samples: DragSample[] = [];
  let detached = false;
  const pendingWaiters: (() => void)[] = [];

  function pushSample(xPx: number): void {
    samples.push({ tMs: performance.now(), xPx });
    if (samples.length > 5) samples.shift();
  }

  function checkWaiters(): void {
    if (pointerDown && isFastDrag(samples)) return;
    const waiters = pendingWaiters.splice(0, pendingWaiters.length);
    for (const resolve of waiters) resolve();
  }

  function onPointerDown(event: PointerEvent): void {
    if (detached) return;
    pointerDown = true;
    activePointerId = event.pointerId;
    lastX = event.clientX;
    samples = [{ tMs: performance.now(), xPx: event.clientX }];
    canvas.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (detached || !pointerDown || event.pointerId !== activePointerId) return;
    const deltaX = event.clientX - lastX;
    lastX = event.clientX;
    const canvasHeightPx = (canvas as HTMLElement).clientHeight;
    azimuthRad += azimuthDeltaForPointerDelta(deltaX, canvasHeightPx);
    pushSample(event.clientX);
    const frameIndex = frameIndexForAzimuth(azimuthRad, options.frames, options.azimuthStartRad);
    options.onFrameChange(frameIndex, azimuthRad);
    checkWaiters();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    pointerDown = false;
    activePointerId = null;
    checkWaiters();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);

  return {
    getAzimuthRad(): number {
      return azimuthRad;
    },
    isPointerDown(): boolean {
      return pointerDown;
    },
    isFastDragging(): boolean {
      return pointerDown && isFastDrag(samples);
    },
    /**
     * Resolves once the drag has slowed below the fast-drag threshold or
     * been released, capped at `maxWaitMs` regardless (§6: "cap the wait at
     * 1 s") so a visitor who keeps flinging the model never blocks the
     * handoff forever.
     */
    waitForSlowdownOrRelease(maxWaitMs: number): Promise<void> {
      if (!pointerDown || !isFastDrag(samples)) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        pendingWaiters.push(finish);
        setTimeout(finish, maxWaitMs);
      });
    },
    detach(): void {
      detached = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      checkWaiters();
    },
  };
}

export type ScrubController = ReturnType<typeof createScrubController>;
