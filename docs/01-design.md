# Understudy — Design (v1)

Status: approved for planning 2026-10-29. Decisions referenced as D-xxx live in `00-decisions.md`.

## 1. Problem

Loading a 3D model on the web today means the visitor stares at a blank box or spinner until the entire glTF (geometry + every texture) has downloaded, parsed, uploaded to the GPU and compiled its shaders. A 4 MB product model on a 1.6 Mbps connection is ~20 s of nothing, then a stutter on the first frame. Video solved this years ago with adaptive streaming (HLS/DASH): a low-quality picture appears immediately and quality climbs as bandwidth allows. 3D on the web has pieces of this (progressive LOD loaders, static poster images) but no end-to-end, open, self-hostable pipeline that delivers an _interactive_ first frame in a few hundred milliseconds.

## 2. Idea

Give every model an **understudy**: a tiny orbit video (AV1, hardware-decoded) rendered from the exact same camera rig and lighting the live viewer will use.

1. Page loads → the understudy's first keyframe arrives (~20–40 KB) → the model is visible.
2. The visitor drags → the video is **scrubbed** frame-by-frame; it feels like rotating the object.
3. Meanwhile the real glTF streams in as a quality ladder: L0 (tiny) → L1 → L2 (full).
4. When L0 is loaded _and_ its shaders are compiled _and_ one frame has been rendered off-screen, the viewer sets the live camera to the exact azimuth the visitor scrubbed to and cross-fades over ~150 ms. Nothing jumps.
5. The visitor now has full orbit/zoom; L1 and L2 are swapped in without flicker as they arrive.

On a device that cannot decode AV1, a royalty-free fallback is used (VP9, then an AVIF frame sequence). On a device too weak for the full model, the policy stops at a lower tier. Nothing in the chain uses H.264/H.265 (D-004).

## 3. Goals and non-goals

Goals (measured by `bench/`, see §10):

- Time-to-first-visual (TTFV) ≤ 500 ms on the `3g-fast` preset after HTML parse, for a model whose plain load takes > 10 s.
- Time-to-interactive (scrub or orbit responds) ≤ 3 s on `3g-fast`.
- No visible jump at handoff: mean absolute pixel difference between the last proxy frame and the first live frame < 2 % at the same azimuth (automated test).
- No main-thread stall > 50 ms during handoff or tier upgrade (shaders precompiled, GPU uploads chunked).
- Zero non-free dependencies; zero H.264/H.265 (CI-enforced).

Non-goals (v1): walkable scenes, animation playback inside the proxy, transparent-background video, AR, server-side rendering, framework bindings beyond a vanilla web component.

## 4. Architecture

```
BUILD TIME (Node CLI: understudy build model.glb -o out/)
  model.glb
    │  P1 build-geometry (gltf-transform: center, simplify, meshopt, KTX2)
    ├──► model.L0.glb  model.L1.glb  model.L2.glb
    │  P2 build-proxy (headless Chromium + @understudy3d/stage)
    ├──► frames/000.png … 071.png  + camera.json
    │  P3 build-encode (ffmpeg: AV1 mp4, VP9 mp4, AVIF seq)   ──► assert-free-codecs
    ├──► proxy-1024.av1.mp4  proxy-512.av1.mp4  proxy-512.vp9.mp4  frames-512/*.avif
    └──► understudy.json  (manifest: bounds, stage params, variants, tiers)

RUN TIME (browser)
  <understudy-viewer src="out/understudy.json">
    viewer (P6)  ── QualityPolicy ──► picks proxy variant + max tier + download mode
      ├─ proxy-player (P4): mp4box.js demux → WebCodecs VideoDecoder → frame LRU
      │     fallback: <video> seek; fallback: AVIF sequence
      ├─ progressive-loader (P5): GLTFLoader + MeshoptDecoder + KTX2Loader, tier by tier,
      │     compileAsync + off-screen warm render before any swap
      └─ stage (P0): one WebGL canvas; proxy frame drawn as a screen-aligned quad in the
            same scene; identical camera rig/env/tone mapping as the build-time renderer
```

Packages (pnpm workspace):

| Package                        | Pipeline                     | Owner wave | Purpose                                                                                            |
| ------------------------------ | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `packages/manifest`            | P0                           | 0          | zod schema + TS types + validator for `understudy.json`                                            |
| `packages/stage`               | P0                           | 0          | camera rig, environment presets, tone mapping, azimuth/elevation math — shared by build and viewer |
| `packages/build-geometry`      | P1                           | 1          | glb → L0/L1/L2                                                                                     |
| `packages/build-proxy`         | P2                           | 1          | glb → PNG frames + camera.json                                                                     |
| `packages/build-encode`        | P3                           | 1          | frames → AV1/VP9/AVIF + manifest patch + codec gate                                                |
| `packages/cli`                 | P0 skeleton, wired in wave 2 | 0/2        | `understudy build` orchestrating P1→P2→P3 and writing the manifest                                 |
| `packages/proxy-player`        | P4                           | 1          | decode + scrub + frame cache                                                                       |
| `packages/progressive-loader`  | P5                           | 1          | tier loading + warm-up                                                                             |
| `packages/viewer`              | P6                           | 2          | state machine, QualityPolicy, handoff, public API, web component                                   |
| `apps/demo`                    | P7                           | 2–3        | GitHub Pages demo: plain vs Understudy, metrics overlay                                            |
| `bench`                        | P7                           | 3          | Playwright network-throttled measurements → `BENCHMARKS.md`                                        |
| `docs`, `README.md`, `.github` | P8                           | 0 + 3      | documentation, codec policy, CI                                                                    |

## 5. Shared contracts (frozen after Wave 0)

### 5.1 Coordinate and camera conventions

- glTF space: right-handed, +Y up, metres. After P1 normalization the model is translated so its bounding-sphere centre is the origin; `bounds.radius` is the sphere radius.
- Camera position for azimuth θ (radians) and elevation φ (radians), distance d, target t:
  `p = t + d · ( sin θ · cos φ,  sin φ,  cos θ · cos φ )`; the camera looks at `t` with up = +Y.
  θ = 0 → camera on +Z (front view); θ increases toward +X. This equals three.js `Spherical.theta` with `phi = π/2 − φ`.
- Fit distance: `d = 1.15 · radius / sin(fov/2)` (vertical fov), computed by `stage.fitDistance()`.
- Frame i of ring r has `θ_i = azimuthStart + i · 2π / frames`, `φ = rings[r].elevation`. Frames are stored ring-major: ring 0 is frames `0..frames−1`, ring 1 is `frames..2·frames−1`, etc. v1 default: 72 frames, one ring at 20° elevation.
- Scrub mapping must feel identical to three.js `OrbitControls` with `rotateSpeed = 1`: for a horizontal pointer delta `Δx` px on a canvas of height `h` px, `θ −= 2π · Δx / h`. Frame index = `round(((θ − azimuthStart) mod 2π) / (2π / frames)) mod frames`.

### 5.2 Manifest `understudy.json` (schema in `packages/manifest`)

```ts
interface Manifest {
  version: 1;
  generator: string; // "understudy-cli@0.1.0"
  source: { name: string; license?: string; attribution?: string };
  bounds: { center: [number, number, number]; radius: number }; // centre is [0,0,0] after normalization
  stage: StageParams; // exactly what P2 used; the viewer must use the same
  proxy: {
    frames: number; // per ring (72)
    rings: { elevationDeg: number }[]; // [{ elevationDeg: 20 }]
    azimuthStartDeg: number; // 0
    fps: number; // nominal timeline fps for <video> seeking (24)
    background: string; // "#ffffff", baked into frames; viewer clear colour must match
    variants: ProxyVariant[]; // ordered by preference
  };
  tiers: Tier[]; // ascending quality: L0, L1, L2
}
interface StageParams {
  fovDeg: number; // 35
  distance: number; // from fitDistance()
  target: [number, number, number]; // [0,0,0]
  environment: 'studio-neutral' | 'studio-warm' | 'none';
  exposure: number; // 1.0
  toneMapping: 'aces' | 'neutral' | 'none';
}
interface ProxyVariant {
  kind: 'video' | 'image-sequence';
  codec: 'av01' | 'vp09' | 'avif';
  container?: 'mp4'; // video only
  url: string; // video file, or pattern with "{i}" (3-digit zero-padded) for sequences
  width: number;
  height: number;
  bytes: number; // total bytes (sum for sequences)
  gop?: number; // keyframe interval, video only (8)
  frames: number; // same value as proxy.frames, carried per-variant (see D-005c)
}
interface Tier {
  id: 'L0' | 'L1' | 'L2';
  url: string; // self-contained .glb
  bytes: number;
  triangles: number;
  maxTextureSize: number;
  extensions: string[]; // ["EXT_meshopt_compression", "KHR_texture_basisu"]
}
```

All URLs are relative to the manifest's own URL.

### 5.3 `@understudy3d/stage` API

```ts
createStage(renderer: THREE.WebGLRenderer, params: StageParams): Stage
interface Stage {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  setView(azimuthRad: number, elevationRad: number): void;   // positions camera per §5.1
  getView(): { azimuthRad: number; elevationRad: number };
  setModel(root: THREE.Object3D | null): void;               // replaces the current model, no flicker (swap after next frame)
  setOverlayFrame(image: TexImageSource | null): void;       // screen-aligned quad showing a proxy frame; null hides it
  setOverlayOpacity(a: number): void;
  render(): void;
  dispose(): void;
}
fitDistance(radius: number, fovDeg: number): number
frameIndexForAzimuth(azimuthRad: number, frames: number, azimuthStartRad: number): number
azimuthForFrameIndex(i: number, frames: number, azimuthStartRad: number): number
```

Environment presets are built-in (three.js `RoomEnvironment` through `PMREMGenerator` for `studio-neutral`; a warm variant with tinted lights). No external HDR files in v1.

### 5.4 `@understudy3d/proxy-player` API (P4)

```ts
selectProxyVariant(variants: ProxyVariant[]): Promise<ProxyVariant | null>   // VideoDecoder.isConfigSupported / canPlayType / AVIF probe
createProxyPlayer(variant: ProxyVariant, baseUrl: string): ProxyPlayer
interface ProxyPlayer {
  readonly firstFrame: Promise<FrameImage>;        // resolves as soon as frame 0 is decodable
  readonly available: { from: number; to: number } // grows while streaming
  onAvailableChange(cb: () => void): () => void;
  getFrame(index: number): Promise<FrameImage>;    // cached; GOP-aware decode on miss
  prefetch(centerIndex: number, radius: number): void;
  readonly bytesLoaded: number; readonly bytesTotal: number;
  dispose(): void;
}
type FrameImage = VideoFrame | ImageBitmap | HTMLImageElement | HTMLVideoElement;
```

### 5.5 `@understudy3d/progressive-loader` API (P5)

```ts
createProgressiveLoader(renderer: THREE.WebGLRenderer, opts?: { ktx2TranscoderPath?: string }): ProgressiveLoader
interface ProgressiveLoader {
  loadTier(tier: Tier, baseUrl: string, onProgress?: (bytes: number) => void): Promise<THREE.Object3D>;
  warm(root: THREE.Object3D, stage: Stage): Promise<void>;   // compileAsync + 1 off-screen render; resolves when GPU-resident
  dispose(): void;
}
```

### 5.6 `@understudy3d/viewer` public API (P6)

```ts
createViewer(container: HTMLElement, options: { src: string; policy?: Partial<QualityPolicyOptions>; background?: string }): Viewer
interface Viewer extends EventTarget {
  readonly state: 'idle' | 'proxy-loading' | 'proxy-ready' | 'warming' | 'handoff' | 'live' | 'upgrading' | 'settled' | 'error';
  readonly degraded: boolean;               // true when no proxy variant could be used
  readonly metrics: { ttfv?: number; tti?: number; ttLive?: number; ttSettled?: number; bytesBeforeFirstVisual: number; bytesTotal: number };
  dispose(): void;
}
// events: 'statechange' (detail.state), 'metrics' (detail = metrics), 'error' (detail.error)
// <understudy-viewer src="…" background="#fff"></understudy-viewer> wraps createViewer
```

## 6. Runtime flow (viewer state machine)

```
idle ─► proxy-loading ─(first frame decoded)─► proxy-ready ─► … scrub …
   │                                                  │
   │ (no usable variant) ► degraded: poster or none   │ L0 loaded + warm() resolved
   └──────────────────────────────────────────────────┴─► handoff (150 ms crossfade, camera = scrub θ) ─► live
live ─(L1 loaded + warmed)─► upgrading ─(swap)─► live ─(L2 …)─► settled
any ─► error (manifest invalid, all tiers failed)
```

Download scheduling (QualityPolicy):

- Measure throughput from the proxy fetch itself (bytes/ms over the first 100 KB) and read `navigator.connection` when present.
- `serial` mode (slow links): proxy to completion → L0 → L1 → L2. `parallel` mode (fast links): proxy + L0 together, then L1, then L2.
- Device tier from `navigator.deviceMemory`, `hardwareConcurrency`, DPR, viewport, and a WebGL renderer-string heuristic; low tier caps at L1 and uses the 512 proxy; the proxy frame cache budget scales with tier (e.g. 12 / 24 / 48 frames).
- Proxy variant by width: 512 when `canvasWidth · DPR ≤ 700`, else 1024.

Handoff rule: never swap on a frame where (a) shaders are not compiled, (b) the model has not been rendered once off-screen, (c) the pointer is mid-drag with velocity above a threshold (wait for release or slow-down; cap the wait at 1 s).

## 7. Build flow (CLI)

`understudy build <model.glb> --out <dir> [--frames 72] [--rings 20] [--proxy-sizes 1024,512] [--env studio-neutral] [--background #ffffff] [--encoder auto|libaom|svt-av1|nvenc]`

1. P1: normalize (centre, prune, dedup, flatten where safe) → tiers with targets L0 ≈ 8 % triangles / 256 px textures (ETC1S), L1 ≈ 35 % / 1024 px (ETC1S), L2 = 100 % / ≤ 2048 px (UASTC when source textures are normal/roughness-heavy, else ETC1S). Record bytes/triangles.
2. P2: serve `packages/stage` bundle to headless Chromium, load L2, render `frames × rings` PNGs at the largest proxy size with `pixelRatio = 1`, antialias on, `preserveDrawingBuffer`. Write `camera.json` (StageParams + per-frame θ/φ).
3. P3: ffmpeg encodes AV1 at each size (downscale with lanczos), VP9 at 512, AVIF sequence at 512. Keyframe interval 8. Verify with ffprobe. Run `assert-free-codecs`.
4. CLI assembles and validates `understudy.json`.

## 8. Error handling

- Manifest invalid → `error` with the zod issue list; the web component renders a plain message.
- Proxy fails after start (decode error, 4xx) → mark degraded, continue to 3D; never block on the proxy.
- A tier fails → keep the current tier; retry once; if L0 fails and no proxy, surface `error`.
- WebGL context lost → dispose and rebuild the stage; restore last state.
- Build: any ffmpeg/ffprobe/toktx failure stops the CLI with the tool's stderr and a one-line hint (install instructions for `toktx`, encoder availability).

## 9. Testing strategy

- Unit (Vitest): manifest schema; azimuth↔frame math; QualityPolicy decisions from fixed inputs; LRU + GOP range math in proxy-player; tier selection.
- Build integration (Vitest, Node): run P1→P3 on `Avocado.glb`; assert tier sizes within targets, ffprobe codec names, manifest validates, frame count/order.
- Browser (Playwright, Chromium): viewer reaches `live` on a fixture; handoff pixel-diff test (render proxy frame k and live view at `θ_k` to two canvases, compare mean abs diff < 2 %); no long tasks > 50 ms during handoff (PerformanceObserver `longtask`); fallback chain by forcing `isConfigSupported` to false.
- CI runs all of the above plus the codec gate and a repo grep that fails on `libx264|x265|h264|hevc` in source.

## 10. Benchmarks (`bench/`)

Presets (Chromium CDP `Network.emulateNetworkConditions`): `3g-fast` 1.6 Mbps↓ / 150 ms RTT, `4g` 9 Mbps / 60 ms, `wifi` 30 Mbps / 20 ms. Models: Avocado (CC0-1.0), BoomBox (CC0-1.0), WaterBottle (CC0-1.0) — see D-005a for why WaterBottle and not DamagedHelmet. Modes: `plain` (GLTFLoader on the original glb, first render = TTFV = TTI) vs `understudy`. 3 runs each, medians to `BENCHMARKS.md` with the exact commit hash and Chromium version.

## 11. Prior art and what is new

- `<model-viewer>` `poster`: a static image before load — not interactive, not camera-synchronized.
- `@needle-tools/gltf-progressive`: screen-density-driven mesh/texture LOD streaming for three.js; LODs are produced by Needle's hosted service. Our ladder is produced locally with free tools and driven by a manifest; it is the closest prior art for P5 and is credited in the README.
- Cesium 3D Tiles / Nexus: hierarchical streaming for massive scenes — a different problem (environments, not objects).
- QuickTime VR object movies and e-commerce 360° spins: pre-rendered frame scrubbing — the ancestor of our proxy, without a live 3D handoff.
- Unreal Pixel Streaming / NVIDIA CloudXR: interactive video rendered server-side — needs a GPU per visitor.
- MPEG V-PCC: compresses point clouds through 2D video codecs — research-grade; not a web product pipeline.
  New here: a hardware-decoded, scrubbable AV1 stand-in rendered by the viewer's own stage code, a manifest-driven quality ladder, and a camera-synchronized, stall-free handoff, as one free, self-hostable pipeline.

## 12. Risks and mitigations

| Risk                                                        | Mitigation                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Safari on pre-M3 Macs / pre-iPhone 15 Pro cannot decode AV1 | VP9 → AVIF → poster fallback chain; capability-probed, never assumed                   |
| Proxy/live look mismatch (colour space, tone mapping)       | Same `stage` code both sides; automated pixel-diff test; sRGB output encoding pinned   |
| libaom encode speed                                         | `cpu-used 6`, 72 frames only; optional SVT-AV1 or NVENC when present                   |
| Streaming demux complexity                                  | P4 milestone A: whole-file fetch; milestone B: streaming with mp4box.js `appendBuffer` |
| Frame cache VRAM on phones                                  | Tiered cache budgets; `VideoFrame.close()` discipline; 512 variant on small screens    |
| Scope creep                                                 | v1 non-goals in §3; roadmap items go to `docs/roadmap.md`, not into briefs             |
