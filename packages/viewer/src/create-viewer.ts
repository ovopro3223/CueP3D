import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  validateManifest,
  resolveUrl,
  type Manifest,
  type ProxyPoster,
  type ProxyVariant,
  type Tier,
} from '@cuep3d/manifest';
import { createStage, degToRad, type Stage } from '@cuep3d/stage';
import { selectProxyVariant, createProxyPlayer, type ProxyPlayer } from '@cuep3d/proxy-player';
import type * as ProgressiveLoaderModule from '@cuep3d/progressive-loader';
import type { ProgressiveLoader } from '@cuep3d/progressive-loader';
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

/**
 * @cuep3d/progressive-loader (GLTFLoader, KTX2Loader with its zstd WASM,
 * meshoptimizer's WASM — roughly half of this package's bundled bytes) is
 * only needed once a tier is about to load, which on a slow link is seconds
 * after the first visual. It is imported lazily, after the first proxy
 * frame is on screen, so its bytes neither delay `createViewer()` from
 * running nor compete with the proxy's first keyframe (D-014).
 */

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

const DATA_URL_PREFIX = /^data:([^;,]+)?(;base64)?,/i;

/**
 * Bytes of the poster: decoded here for a `data:` URL rather than passed to
 * `fetch()`. Measured: Chromium routes even a `data:` fetch through its
 * network stack, where DevTools/CDP throttling queues it behind the proxy
 * video's first block — 600 ms for 2.8 KB that were already in memory. A
 * non-data URL (a poster served as its own file) is fetched normally.
 */
async function posterBlob(poster: ProxyPoster, manifestUrl: string): Promise<Blob | null> {
  const match = DATA_URL_PREFIX.exec(poster.url);
  if (match) {
    const payload = poster.url.slice(match[0].length);
    const binary = match[2] ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] ?? 'image/avif' });
  }
  const response = await fetch(resolveUrl(manifestUrl, poster.url));
  return response.ok ? response.blob() : null;
}

/**
 * D-014: decodes the manifest's inline poster (frame 0 as an AVIF still)
 * off the main thread. Never rejects — a missing or undecodable poster just
 * means the first visual is the first decoded video frame, as before.
 */
async function decodePoster(
  poster: ProxyPoster | undefined,
  manifestUrl: string,
): Promise<ImageBitmap | null> {
  if (!poster || typeof createImageBitmap === 'undefined') return null;
  try {
    const blob = await posterBlob(poster, manifestUrl);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
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
  private loaderModule: typeof ProgressiveLoaderModule | null = null;
  private loaderModulePromise: Promise<typeof ProgressiveLoaderModule> | null = null;
  private posterBitmap: ImageBitmap | null = null;
  private posterShown = false;
  private firstVideoFrameShown = false;
  private applySize: (() => void) | null = null;
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
      (window as unknown as Record<string, unknown>).__cuep3dMetrics = snapshot;
    }
  }

  private async start(): Promise<void> {
    const manifestUrl = new URL(
      this.options.src,
      typeof document !== 'undefined' ? document.baseURI : undefined,
    ).toString();

    // Ordered by what the visitor is waiting for (D-014). The manifest
    // request goes out first; the canvas and WebGL context are built while
    // it is in flight, since they need nothing from it. Once the manifest
    // is in: start the proxy fetch — the one other round trip nothing can
    // remove — *before* building the stage, so the PMREM environment's tens
    // of milliseconds of main-thread work overlap the first proxy bytes'
    // travel instead of delaying the request that fetches them.
    const manifestRequest = fetch(manifestUrl);
    const renderer = this.setupRenderer();

    let manifest: Manifest;
    let manifestBytes = 0;
    try {
      const response = await manifestRequest;
      if (!response.ok) {
        throw new Error(
          `Failed to fetch manifest: ${String(response.status)} ${response.statusText}`,
        );
      }
      const text = await response.text();
      manifestBytes = new TextEncoder().encode(text).byteLength;
      manifest = validateManifest(JSON.parse(text) as unknown);
    } catch (error) {
      this.fail(toError(error));
      return;
    }
    if (this.disposed) return;

    this.container.style.backgroundColor = this.options.background ?? manifest.proxy.background;
    renderer.setClearColor(new THREE.Color(manifest.proxy.background), 1);

    // The inline poster (frame 0 as an AVIF still) decodes off-thread in
    // parallel with everything below; it needs no further request.
    const posterPromise = decodePoster(manifest.proxy.poster, manifestUrl);

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
    const selectedVariant = await selectProxyVariant(candidates);
    if (this.disposed) {
      void posterPromise.then((bitmap) => bitmap?.close());
      return;
    }

    const decision = chooseQuality({
      options: policyOptions,
      selectedVariant,
      availableTierIds: manifest.tiers.map((t) => t.id),
    });

    // The proxy fetch starts here — before the stage exists.
    let proxyPlayer: ProxyPlayer | null = null;
    if (decision.proxyVariant) {
      try {
        proxyPlayer = createProxyPlayer(decision.proxyVariant, manifestUrl);
      } catch {
        proxyPlayer = null;
      }
    }

    const stage = this.setupStage(renderer, manifest);
    this.startRenderLoop();
    this.setState({ type: 'manifest-loaded' });

    void posterPromise.then((bitmap) => this.showPoster(bitmap, stage, manifestBytes));

    const azimuthStartRad = degToRad(manifest.proxy.azimuthStartDeg);
    const elevationRad = degToRad(manifest.proxy.rings[0]?.elevationDeg ?? 0);

    const livePlayer = await this.startProxyPhase(
      manifest,
      decision,
      stage,
      proxyPlayer,
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
      proxyPlayer: livePlayer,
    });
  }

  /** Shows the decoded inline poster, unless a video frame (or the live model) got there first. */
  private showPoster(bitmap: ImageBitmap | null, stage: Stage, manifestBytes: number): void {
    if (!bitmap) return;
    const stillWaitingForFirstVisual =
      !this.disposed &&
      !this.firstVideoFrameShown &&
      (this._state === 'proxy-loading' || this._state === 'warming');
    if (!stillWaitingForFirstVisual) {
      bitmap.close();
      return;
    }
    stage.setOverlayFrame(bitmap);
    stage.setOverlayOpacity(1);
    this.posterBitmap = bitmap;
    this.posterShown = true;
    this.metricsTracker.markTtfv(manifestBytes);
    this.dispatchMetrics();
  }

  private closePoster(): void {
    this.posterBitmap?.close();
    this.posterBitmap = null;
  }

  /** Started at the TTI mark, or at once when the proxy is unusable; awaited by runTierPipeline either way. */
  private startLoaderImport(): Promise<typeof ProgressiveLoaderModule> {
    if (!this.loaderModulePromise) {
      this.loaderModulePromise = import('@cuep3d/progressive-loader').then((module) => {
        this.loaderModule = module;
        return module;
      });
      // runTierPipeline awaits (and handles) this; until it does, a rejection
      // must not surface as an unhandled one.
      this.loaderModulePromise.catch(() => undefined);
    }
    return this.loaderModulePromise;
  }

  /** Canvas + WebGL context: needs nothing from the manifest, so it is built while that request is in flight. */
  private setupRenderer(): THREE.WebGLRenderer {
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }

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
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, MAX_DPR);
    renderer.setPixelRatio(dpr);

    const applySize = (): void => {
      const width = Math.max(1, this.container.clientWidth);
      const height = Math.max(1, this.container.clientHeight);
      renderer.setSize(width, height, false);
      if (this.stage) {
        this.stage.camera.aspect = width / height;
        this.stage.camera.updateProjectionMatrix();
      }
    };
    applySize();
    this.applySize = applySize;

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(applySize);
      resizeObserver.observe(this.container);
      this.disposers.push(() => resizeObserver.disconnect());
    }

    const onContextLost = (event: Event): void => event.preventDefault();
    const onContextRestored = (): void => {
      applySize();
      this.stage?.render();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    this.disposers.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    });

    return renderer;
  }

  /** Scene, camera and PMREM environment from the manifest's stage params (D-007). */
  private setupStage(renderer: THREE.WebGLRenderer, manifest: Manifest): Stage {
    // The environment map is built later (`stage.ensureEnvironment()`), once
    // something is on screen: the overlay quad is unlit, and the PMREM work
    // is the largest GPU job before the first frame — on the bench's
    // headless Chromium the first canvas present waited ~550 ms for it.
    const stage = createStage(renderer, manifest.stage, { deferEnvironment: true });
    this.stage = stage;
    this.applySize?.();

    // Debug-only introspection hook (parallel to `window.__cuep3dMetrics`,
    // §5.6 point 9) — not part of the frozen Viewer surface, used by this
    // package's own Playwright tests (e.g. `renderer.info.memory` for the
    // dispose/leak test) and available to the bench under the same flag.
    if (this.options.debug && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__cuep3dDebug = { renderer, stage };
    }

    return stage;
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
    decision: QualityPolicyDecision,
    stage: Stage,
    proxyPlayer: ProxyPlayer | null,
    azimuthStartRad: number,
    elevationRad: number,
  ): Promise<ProxyPlayer | null> {
    if (!proxyPlayer || !decision.proxyVariant) {
      this._degraded = true;
      this.setState({ type: 'proxy-degraded' });
      stage.ensureEnvironment();
      void this.startLoaderImport();
      return null;
    }

    try {
      const firstFrame = await proxyPlayer.firstFrame;
      if (this.disposed) {
        proxyPlayer.dispose();
        return null;
      }
      this.firstVideoFrameShown = true;
      stage.setOverlayFrame(firstFrame);
      stage.setOverlayOpacity(1);
      // The poster (if one was up) is frame 0 of the same orbit; the decoded
      // keyframe simply takes its place. Its upload is synchronous (D-013),
      // so the bitmap can go now.
      this.closePoster();
      this.metricsTracker.markTtfv(proxyPlayer.bytesLoaded);
      this.metricsTracker.markTtProxyFrame();
      this.dispatchMetrics();
    } catch {
      // §8: "Proxy fails after start → mark degraded, continue to 3D;
      // never block on the proxy." A poster already on screen stays up.
      proxyPlayer.dispose();
      this._degraded = true;
      this.setState({ type: 'proxy-degraded' });
      stage.ensureEnvironment();
      void this.startLoaderImport();
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
    // Three GOPs decodable (§6 / §5.6): `available` is an inclusive index
    // range, so three GOPs of 8 are frames 0..23 — a span of 23, not 24.
    // (Before D-014 this compared `to - from` against the frame count and
    // so waited for a fourth GOP.)
    const requiredFrames = Math.min(totalFrames, (variant.gop ?? totalFrames) * 3);
    const check = (): void => {
      const { from, to } = proxyPlayer.available;
      if (to - from + 1 >= requiredFrames) {
        this.metricsTracker.markTti();
        this.dispatchMetrics();
        unsubscribe();
        // The proxy is interactive; only now spend GPU time and bandwidth
        // on what the 3D pipeline needs next (D-014): the PMREM environment
        // (on the bench's software-rendered Chromium its GPU work stalls the
        // main thread ~550 ms; built any earlier, that stall sat on the
        // first frame or on the GOPs this mark waits for) and the loader
        // chunk (GLTFLoader, KTX2, meshopt — ~90 KB that, started at the
        // first frame, halved the proxy's throughput and pushed TTI from
        // ~650 to ~920 ms on 3g-fast). runTierPipeline awaits/ensures both
        // regardless, so a proxy that never reaches this point still gets
        // its tiers.
        this.stage?.ensureEnvironment();
        void this.startLoaderImport();
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

    const tiers = tiersToLoad(manifest.tiers, decision.maxTier);
    if (tiers.length === 0) {
      this.fail(new Error('QualityPolicy resolved maxTier to a tier the manifest does not have.'));
      return;
    }

    if (decision.downloadMode === 'serial' && proxyPlayer) {
      await waitForProxyComplete(proxyPlayer);
    }
    if (this.disposed) return;

    // In serial mode the TTI watcher has normally started this import
    // already (and the proxy is complete by now); in parallel mode this is
    // where it starts, alongside the proxy.
    let loaderModule: typeof ProgressiveLoaderModule;
    try {
      loaderModule = await this.startLoaderImport();
    } catch (error) {
      // Same contract as a failed tier (§8): with a proxy up, stay on it;
      // with nothing on screen, surface the error.
      if (this._degraded && !this.posterShown) this.fail(toError(error));
      return;
    }
    if (this.disposed) return;

    const ktx2TranscoderPath = resolveUrl(manifestUrl, 'basis/');
    const loader = loaderModule.createProgressiveLoader(renderer, { ktx2TranscoderPath });
    this.progressiveLoader = loader;

    let bytesTotal = proxyPlayer?.bytesLoaded ?? 0;
    const tier0 = tiers[0]!;
    if (this._state === 'proxy-ready') this.setState({ type: 'tier-warm' });

    let currentRoot: THREE.Object3D;
    try {
      const tier0Load = loadTierWithRetry(loader, tier0, manifestUrl, (bytes) => {
        this.metricsTracker.setBytesTotal((proxyPlayer?.bytesLoaded ?? 0) + bytes);
        this.dispatchMetrics();
      });
      // warm() compiles against stage.scene, so the environment must exist
      // by now (normally built at the TTI mark; a no-op then).
      stage.ensureEnvironment();
      currentRoot = await tier0Load;
      await loader.warm(currentRoot, stage);
    } catch (error) {
      if (this._degraded && !this.posterShown) {
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
      stage.setView(azimuthStartRad, elevationRad);
      stage.setModel(currentRoot);
      if (this.posterBitmap) {
        // No video ever decoded, but the poster (frame 0, at the start
        // azimuth the camera is still at) is on screen: cross-fade it out
        // over the live model like a real handoff rather than cutting.
        await this.runCrossfade();
        if (this.disposed) return;
        stage.setOverlayFrame(null);
        this.closePoster();
      }
      this.setupControls(stage, manifest, azimuthStartRad, elevationRad);
      this.setState({ type: 'handoff-skip' });
      // With a poster, the first visual (and its byte count) was the manifest.
      this.metricsTracker.markTtLive(this.posterShown ? undefined : bytesTotal);
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
      loaderModule.disposeObject(currentRoot);
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
    this.closePoster();
    if (this.currentRoot) this.loaderModule?.disposeObject(this.currentRoot);
    this.stage?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}

export function createViewer(container: HTMLElement, options: ViewerOptions): Viewer {
  return new ViewerImpl(container, options);
}
