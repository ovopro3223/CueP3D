import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  validateManifest,
  resolveUrl,
  type Manifest,
  type ProxyVariant,
  type Tier,
} from '@understudy3d/manifest';
import { createStage, degToRad, type Stage } from '@understudy3d/stage';
import {
  selectProxyVariant,
  createProxyPlayer,
  type ProxyPlayer,
} from '@understudy3d/proxy-player';
import {
  createProgressiveLoader,
  disposeObject,
  type ProgressiveLoader,
} from '@understudy3d/progressive-loader';
import {
  chooseQuality,
  classifyDeviceTier,
  desiredProxyWidth,
  orderVariantsByPreferredWidth,
  TIER_ORDER,
  type QualityPolicyDecision,
  type QualityPolicyOptions,
  type TierId,
} from './quality-policy.js';
import { detectDeviceSignals } from './device-signals.js';
import { transition, type ViewerEvent, type ViewerState } from './state-machine.js';
import { createScrubController, type ScrubController } from './scrub-controller.js';
import { createMetricsTracker, type MetricsTracker } from './metrics.js';
import type {
  ErrorEventDetail,
  MetricsEventDetail,
  StateChangeEventDetail,
  Viewer,
  ViewerMetrics,
  ViewerOptions,
} from './types.js';

const HANDOFF_CROSSFADE_MS = 150;
/** §6: "wait for release or slow-down, cap the wait at 1 s". */
const HANDOFF_MAX_WAIT_MS = 1000;
const MAX_DPR = 2;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function tiersToLoad(tiers: readonly Tier[], maxTier: TierId): Tier[] {
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  const byId = new Map(tiers.map((t) => [t.id, t] as const));
  const result: Tier[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    const id = TIER_ORDER[i];
    const tier = id ? byId.get(id) : undefined;
    if (tier) result.push(tier);
  }
  return result;
}

/** §8: "a tier fails → keep the current tier; retry once." */
async function loadTierWithRetry(
  loader: ProgressiveLoader,
  tier: Tier,
  baseUrl: string,
  onProgress?: (bytes: number) => void,
): Promise<THREE.Object3D> {
  try {
    return await loader.loadTier(tier, baseUrl, onProgress);
  } catch {
    return await loader.loadTier(tier, baseUrl, onProgress);
  }
}

function waitForProxyComplete(player: ProxyPlayer): Promise<void> {
  const isComplete = (): boolean =>
    player.bytesTotal > 0 && player.bytesLoaded >= player.bytesTotal;
  if (isComplete()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = player.onAvailableChange(() => {
      if (isComplete()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

interface RuntimeContext {
  manifest: Manifest;
  manifestUrl: string;
  decision: QualityPolicyDecision;
  stage: Stage;
  renderer: THREE.WebGLRenderer;
  azimuthStartRad: number;
  elevationRad: number;
  proxyPlayer: ProxyPlayer | null;
}

class ViewerImpl extends EventTarget implements Viewer {
  private _state: ViewerState = 'idle';
  private _degraded = false;
  private readonly metricsTracker: MetricsTracker;
  private disposed = false;
  private readonly disposers: Array<() => void> = [];

  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private stage: Stage | null = null;
  private proxyPlayer: ProxyPlayer | null = null;
  private progressiveLoader: ProgressiveLoader | null = null;
  private scrubController: ScrubController | null = null;
  private controls: OrbitControls | null = null;
  private currentRoot: THREE.Object3D | null = null;
  private crossfade: { resolve: () => void; startMs: number; durationMs: number } | null = null;
  private rafHandle: number | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ViewerOptions,
  ) {
    super();
    this.metricsTracker = createMetricsTracker(performance.now());
    void this.start().catch((error: unknown) => this.fail(toError(error)));
  }

  get state(): ViewerState {
    return this._state;
  }

  get degraded(): boolean {
    return this._degraded;
  }

  get metrics(): ViewerMetrics {
    return this.metricsTracker.snapshot();
  }

  private setState(event: ViewerEvent): void {
    if (this.disposed) return;
    this._state = transition(this._state, event);
    this.dispatchEvent(
      new CustomEvent<StateChangeEventDetail>('statechange', { detail: { state: this._state } }),
    );
  }

  private fail(error: Error): void {
    if (this.disposed || this._state === 'error') return;
    this.setState({ type: 'fail' });
    this.dispatchEvent(new CustomEvent<ErrorEventDetail>('error', { detail: { error } }));
  }

  private dispatchMetrics(): void {
    const snapshot = this.metricsTracker.snapshot();
    this.dispatchEvent(new CustomEvent<MetricsEventDetail>('metrics', { detail: snapshot }));
    if (this.options.debug && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__understudyMetrics = snapshot;
    }
  }

  private async start(): Promise<void> {
    const manifestUrl = new URL(
      this.options.src,
      typeof document !== 'undefined' ? document.baseURI : undefined,
    ).toString();

    let manifest: Manifest;
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch manifest: ${String(response.status)} ${response.statusText}`,
        );
      }
      manifest = validateManifest(await response.json());
    } catch (error) {
      this.fail(toError(error));
      return;
    }
    if (this.disposed) return;

    const { renderer, stage } = this.setupScene(manifest);
    this.startRenderLoop();

    this.setState({ type: 'manifest-loaded' });

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, MAX_DPR);
    const canvasCssWidth = Math.max(1, this.container.clientWidth);
    const detected = detectDeviceSignals(renderer);
    const policyOptions: QualityPolicyOptions = {
      canvasCssWidth,
      dpr,
      ...detected,
      ...this.options.policy,
    };
    const deviceTier = classifyDeviceTier(policyOptions);
    const width = desiredProxyWidth(canvasCssWidth, dpr, deviceTier);
    const candidates = orderVariantsByPreferredWidth(manifest.proxy.variants, width);
    const selectedVariant = this.disposed ? null : await selectProxyVariant(candidates);
    if (this.disposed) return;

    const decision = chooseQuality({
      options: policyOptions,
      selectedVariant,
      availableTierIds: manifest.tiers.map((t) => t.id),
    });

    const azimuthStartRad = degToRad(manifest.proxy.azimuthStartDeg);
    const elevationRad = degToRad(manifest.proxy.rings[0]?.elevationDeg ?? 0);

    const proxyPlayer = await this.startProxyPhase(
      manifest,
      manifestUrl,
      decision,
      stage,
      azimuthStartRad,
      elevationRad,
    );
    if (this.disposed) return;

    await this.runTierPipeline({
      manifest,
      manifestUrl,
      decision,
      stage,
      renderer,
      azimuthStartRad,
      elevationRad,
      proxyPlayer,
    });
  }

  private setupScene(manifest: Manifest): { renderer: THREE.WebGLRenderer; stage: Stage } {
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.style.backgroundColor = this.options.background ?? manifest.proxy.background;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);
    this.canvas = canvas;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // Needed to read the canvas back reliably (screenshots, this
      // package's own pixel-diff test) — a WebGL canvas's backbuffer is
      // otherwise undefined immediately after compositing. Costs an extra
      // internal copy per frame; worth it for a viewer visitors may want to
      // screenshot/share, and for being testable at all.
      preserveDrawingBuffer: true,
    });
    this.renderer = renderer;
    renderer.setClearColor(new THREE.Color(manifest.proxy.background), 1);
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, MAX_DPR);
    renderer.setPixelRatio(dpr);

    const stage = createStage(renderer, manifest.stage);
    this.stage = stage;

    // Debug-only introspection hook (parallel to `window.__understudyMetrics`,
    // §5.6 point 9) — not part of the frozen Viewer surface, used by this
    // package's own Playwright tests (e.g. `renderer.info.memory` for the
    // dispose/leak test) and available to the bench under the same flag.
    if (this.options.debug && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__understudyDebug = { renderer, stage };
    }

    const applySize = (): void => {
      const width = Math.max(1, this.container.clientWidth);
      const height = Math.max(1, this.container.clientHeight);
      renderer.setSize(width, height, false);
      stage.camera.aspect = width / height;
      stage.camera.updateProjectionMatrix();
    };
    applySize();

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(applySize);
      resizeObserver.observe(this.container);
      this.disposers.push(() => resizeObserver.disconnect());
    }

    const onContextLost = (event: Event): void => event.preventDefault();
    const onContextRestored = (): void => {
      applySize();
      renderer.render(stage.scene, stage.camera);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    this.disposers.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    });

    return { renderer, stage };
  }

  private startRenderLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.controls?.update();
      if (this.crossfade && this.stage) {
        const elapsed = performance.now() - this.crossfade.startMs;
        const alpha = Math.max(0, 1 - elapsed / this.crossfade.durationMs);
        this.stage.setOverlayOpacity(alpha);
        if (elapsed >= this.crossfade.durationMs) {
          const { resolve } = this.crossfade;
          this.crossfade = null;
          resolve();
        }
      }
      this.stage?.render();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private runCrossfade(): Promise<void> {
    return new Promise((resolve) => {
      this.crossfade = { resolve, startMs: performance.now(), durationMs: HANDOFF_CROSSFADE_MS };
    });
  }

  /** Resolves to the live ProxyPlayer (or null if degraded) once the proxy
   * phase has reached its terminal outcome for this run: a usable first
   * frame, or a decision to skip the proxy entirely. */
  private async startProxyPhase(
    manifest: Manifest,
    manifestUrl: string,
    decision: QualityPolicyDecision,
    stage: Stage,
    azimuthStartRad: number,
    elevationRad: number,
  ): Promise<ProxyPlayer | null> {
    if (!decision.proxyVariant) {
      this._degraded = true;
      this.setState({ type: 'proxy-degraded' });
      return null;
    }

    let proxyPlayer: ProxyPlayer;
    try {
      proxyPlayer = createProxyPlayer(decision.proxyVariant, manifestUrl);
      const firstFrame = await proxyPlayer.firstFrame;
      if (this.disposed) {
        proxyPlayer.dispose();
        return null;
      }
      stage.setOverlayFrame(firstFrame);
      stage.setOverlayOpacity(1);
      this.metricsTracker.markTtfv(proxyPlayer.bytesLoaded);
      this.dispatchMetrics();
    } catch {
      // §8: "Proxy fails after start → mark degraded, continue to 3D;
      // never block on the proxy."
      this._degraded = true;
      this.setState({ type: 'proxy-degraded' });
      return null;
    }

    this.proxyPlayer = proxyPlayer;
    this.setState({ type: 'proxy-ready' });
    this.startScrubbing(manifest, decision, proxyPlayer, azimuthStartRad, elevationRad);
    this.startTtiWatcher(proxyPlayer, decision.proxyVariant, manifest.proxy.frames);
    return proxyPlayer;
  }

  private startScrubbing(
    manifest: Manifest,
    decision: QualityPolicyDecision,
    proxyPlayer: ProxyPlayer,
    azimuthStartRad: number,
    elevationRad: number,
  ): void {
    if (!this.canvas || !this.stage) return;
    // cacheBudget (12/24/48) is the player's internal LRU sizing intent;
    // this scales how many neighbouring frames each drag step asks the
    // player to look ahead and decode (see quality-policy.ts's doc comment
    // on `cacheBudget` — proxy-player's LRU size itself isn't an option on
    // the frozen createProxyPlayer signature).
    const prefetchRadius = Math.max(2, Math.round(decision.cacheBudget / 6));
    let latestRequested = -1;

    const controller = createScrubController(this.canvas, {
      frames: manifest.proxy.frames,
      azimuthStartRad,
      initialAzimuthRad: azimuthStartRad,
      onFrameChange: (frameIndex, azimuthRad) => {
        latestRequested = frameIndex;
        this.stage?.setView(azimuthRad, elevationRad);
        proxyPlayer
          .getFrame(frameIndex)
          .then((frame) => {
            // Only the most recently requested frame may ever be shown —
            // an earlier request resolving later must not overwrite it
            // (brief §3: "Show frames only in increasing-recency order").
            if (this.disposed || frameIndex !== latestRequested) return;
            this.stage?.setOverlayFrame(frame);
          })
          .catch(() => {
            // A single frame's decode failing must not interrupt scrubbing
            // (§8) — the previously-shown frame simply stays up.
          });
        proxyPlayer.prefetch(frameIndex, prefetchRadius);
      },
    });
    this.scrubController = controller;
    this.disposers.push(() => controller.detach());
  }

  private startTtiWatcher(
    proxyPlayer: ProxyPlayer,
    variant: ProxyVariant,
    totalFrames: number,
  ): void {
    const requiredSpan = Math.min(totalFrames, (variant.gop ?? totalFrames) * 3);
    const check = (): void => {
      const { from, to } = proxyPlayer.available;
      if (to - from >= requiredSpan) {
        this.metricsTracker.markTti();
        this.dispatchMetrics();
        unsubscribe();
      }
    };
    const unsubscribe = proxyPlayer.onAvailableChange(check);
    this.disposers.push(unsubscribe);
    check();
  }

  private setupControls(
    stage: Stage,
    manifest: Manifest,
    azimuthRad: number,
    elevationRad: number,
  ): void {
    if (!this.canvas) return;
    stage.setView(azimuthRad, elevationRad);
    const controls = new OrbitControls(stage.camera, this.canvas);
    controls.target.set(
      manifest.stage.target[0],
      manifest.stage.target[1],
      manifest.stage.target[2],
    );
    controls.enableDamping = true;
    controls.rotateSpeed = 1;
    // Zoom limits derived from the model's own bounding radius (brief §5):
    // never let the visitor zoom inside the object or out past a point
    // where it's a speck — 0.6x/6x are generous multiples either side of
    // the build-time framing distance, not tied to any specific model.
    controls.minDistance = manifest.bounds.radius * 0.6;
    controls.maxDistance = manifest.bounds.radius * 6;
    controls.update();
    this.controls = controls;
    this.disposers.push(() => controls.dispose());
  }

  private async runTierPipeline(ctx: RuntimeContext): Promise<void> {
    const {
      manifest,
      manifestUrl,
      decision,
      stage,
      renderer,
      azimuthStartRad,
      elevationRad,
      proxyPlayer,
    } = ctx;

    const ktx2TranscoderPath = resolveUrl(manifestUrl, 'basis/');
    const loader = createProgressiveLoader(renderer, { ktx2TranscoderPath });
    this.progressiveLoader = loader;

    const tiers = tiersToLoad(manifest.tiers, decision.maxTier);
    if (tiers.length === 0) {
      this.fail(new Error('QualityPolicy resolved maxTier to a tier the manifest does not have.'));
      return;
    }

    if (decision.downloadMode === 'serial' && proxyPlayer) {
      await waitForProxyComplete(proxyPlayer);
    }
    if (this.disposed) return;

    let bytesTotal = proxyPlayer?.bytesLoaded ?? 0;
    const tier0 = tiers[0]!;
    if (this._state === 'proxy-ready') this.setState({ type: 'tier-warm' });

    let currentRoot: THREE.Object3D;
    try {
      currentRoot = await loadTierWithRetry(loader, tier0, manifestUrl, (bytes) => {
        this.metricsTracker.setBytesTotal((proxyPlayer?.bytesLoaded ?? 0) + bytes);
        this.dispatchMetrics();
      });
      await loader.warm(currentRoot, stage);
    } catch (error) {
      if (this._degraded) {
        // §8: "if L0 fails and no proxy, surface error" — nothing was ever
        // shown, so there is nothing to fall back to.
        this.fail(toError(error));
      }
      // Otherwise the proxy is still up; stay there rather than crash.
      return;
    }
    bytesTotal += tier0.bytes;
    if (this.disposed) return;

    if (this._degraded) {
      // Model and controls must be fully in place BEFORE the 'live'
      // statechange fires (matches the non-degraded branch below) — a
      // listener reacting to 'live' should see a scene that is actually
      // ready to render, not one still a tick away from it.
      stage.setModel(currentRoot);
      this.setupControls(stage, manifest, azimuthStartRad, elevationRad);
      this.setState({ type: 'handoff-skip' });
      this.metricsTracker.markTtLive(bytesTotal);
    } else {
      // Handoff rule (§6): (a) shaders compiled and (b) one off-screen
      // render done are both already guaranteed by warm() having resolved;
      // only (c) "not mid-fast-drag" remains to check here.
      await this.scrubController?.waitForSlowdownOrRelease(HANDOFF_MAX_WAIT_MS);
      if (this.disposed) return;

      this.setState({ type: 'handoff-start' });
      const azimuthRad = this.scrubController?.getAzimuthRad() ?? azimuthStartRad;
      stage.setView(azimuthRad, elevationRad);
      stage.setModel(currentRoot);
      await this.runCrossfade();
      if (this.disposed) return;

      stage.setOverlayFrame(null);
      this.scrubController?.detach();
      proxyPlayer?.dispose();
      this.proxyPlayer = null;
      this.setupControls(stage, manifest, azimuthRad, elevationRad);
      this.setState({ type: 'handoff-done' });
      this.metricsTracker.markTtLive();
    }
    this.currentRoot = currentRoot;
    this.dispatchMetrics();

    for (let i = 1; i < tiers.length; i++) {
      const tier = tiers[i]!;
      let nextRoot: THREE.Object3D;
      try {
        nextRoot = await loadTierWithRetry(loader, tier, manifestUrl, (bytes) => {
          this.dispatchMetrics();
          this.metricsTracker.setBytesTotal(bytesTotal + bytes);
        });
        await loader.warm(nextRoot, stage);
      } catch {
        break; // §8: keep the current tier.
      }
      bytesTotal += tier.bytes;
      if (this.disposed) return;

      this.setState({ type: 'upgrade-start' });
      stage.setModel(nextRoot);
      disposeObject(currentRoot);
      currentRoot = nextRoot;
      this.currentRoot = currentRoot;
      this.setState({ type: 'upgrade-done' });
      this.metricsTracker.setBytesTotal(bytesTotal);
      this.dispatchMetrics();
    }

    this.setState({ type: 'settle' });
    this.metricsTracker.markTtSettled();
    this.dispatchMetrics();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafHandle !== undefined) cancelAnimationFrame(this.rafHandle);
    for (const cleanup of this.disposers.splice(0, this.disposers.length)) cleanup();

    this.scrubController?.detach();
    this.proxyPlayer?.dispose();
    this.progressiveLoader?.dispose();
    if (this.currentRoot) disposeObject(this.currentRoot);
    this.stage?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}

export function createViewer(container: HTMLElement, options: ViewerOptions): Viewer {
  return new ViewerImpl(container, options);
}
