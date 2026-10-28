# P2 — build-proxy (Sonnet 4.6, Wave 1)

Read first: `docs/00-decisions.md` (D-007), `docs/01-design.md` §5.1, §5.3, §7 step 2, agent protocol in `docs/02-plan.md`.

## Goal

`packages/build-proxy`: render the orbit frames for the understudy video in headless Chromium using the shared `@understudy3d/stage` package, so the frames match what the live viewer will render pixel-for-pixel.

## Input

```ts
export async function renderProxyFrames(opts: {
  modelUrlOrPath: string; // the L2 tier .glb (or model.norm.glb) from P1
  outDir: string; // writes <outDir>/frames/NNN.png and <outDir>/camera.json
  size: number; // square render size, the largest proxy size (1024)
  frames: number; // 72
  ringsDeg: number[]; // [20]
  azimuthStartDeg: number; // 0
  stage: Omit<StageParams, 'distance'>; // distance is computed from bounds via fitDistance
  background: string; // "#ffffff"
  bounds: { center: [number, number, number]; radius: number };
}): Promise<{ framesDir: string; cameraJson: string; stage: StageParams }>;
```

## Output

- `frames/000.png … NNN.png`, ring-major order per §5.1, exactly `size × size`, opaque, background baked.
- `camera.json`: `{ stage: StageParams, frames, ringsDeg, azimuthStartDeg, perFrame: [{ i, azimuthDeg, elevationDeg }] }`.

## Implementation notes

- Bundle a tiny page (`render-page.html` + `render-page.ts` built with Vite library mode or esbuild at package build time) that imports `@understudy3d/stage`, three.js `GLTFLoader` + `MeshoptDecoder` + `KTX2Loader` (transcoder files served from `three/examples/jsm/libs/basis`), exposes `window.__understudyRender = { load(url), setView(θ, φ), snapshot(): Promise<Uint8Array PNG> }`.
- Serve `outDir`, the page bundle and the transcoder files from a local static server on an ephemeral port (Node `http`), no external network.
- Launch Puppeteer (`puppeteer` package, downloads Chromium) with `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` as the default (deterministic, works in CI); flag `--gpu` to use the host GPU locally. `deviceScaleFactor: 1`, viewport `size × size`.
- Renderer: `antialias: true`, `preserveDrawingBuffer: true`, `setPixelRatio(1)`, `outputColorSpace = SRGBColorSpace`, tone mapping from `stage`. Take frames via `canvas.toBlob('image/png')` → base64 → Node, not `page.screenshot` (avoids compositor scaling).
- Wait for `renderer.compileAsync` and two warm renders before the first snapshot (the first frames otherwise come out dark while PMREM/KTX2 settle).
- Expose progress callbacks; total time for 72 frames at 1024 under SwiftShader should stay under ~3 minutes on the owner's laptop; report the number.

## Tests (Vitest, Node; Puppeteer required)

- Render 8 frames at 256 of `Avocado` L2: 8 PNGs exist, each 256×256; mean colour of frame 0 differs from frame 4 (the object rotated); corner pixels equal the background colour.
- `camera.json` round-trips through the §5.1 math: `azimuthForFrameIndex(i) === perFrame[i].azimuthDeg` in radians within 1e-9.
- Determinism: rendering frame 0 twice gives byte-identical PNGs under SwiftShader.

## Out of scope

Encoding (P3), any lighting other than the stage presets, transparent backgrounds, Blender.

## Report

`docs/reports/P2-report.md` with render times (SwiftShader vs `--gpu`) and a contact sheet PNG of 12 frames.
