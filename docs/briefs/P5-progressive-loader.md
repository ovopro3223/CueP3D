# P5 — progressive-loader (Sonnet 4.6, Wave 1)

Read first: `docs/00-decisions.md` (D-008), `docs/01-design.md` §5.2 (Tier), §5.3, §5.5, §6, agent protocol in `docs/02-plan.md`.

## Goal

`packages/progressive-loader`: load one quality tier at a time with meshopt and KTX2 decoding, and guarantee that a tier is fully GPU-resident and shader-compiled _before_ the viewer is allowed to show it. The "no stutter" promise lives here.

## API (frozen, §5.5)

`createProgressiveLoader(renderer, opts)`, `loadTier(tier, baseUrl, onProgress)`, `warm(root, stage)`, `dispose()`.

## Implementation notes

- three.js `GLTFLoader` with `setMeshoptDecoder(MeshoptDecoder)` (`meshoptimizer` package) and `KTX2Loader` with `setTranscoderPath(opts.ktx2TranscoderPath ?? default)` + `detectSupport(renderer)`; one `KTX2Loader` per loader instance, disposed in `dispose()`.
- Progress: wrap fetch with a `ReadableStream` reader to report bytes (GLTFLoader's `onProgress` is unreliable with compression); pass the ArrayBuffer to `loader.parse`.
- `warm(root, stage)`: add `root` to a hidden group in `stage.scene` (`visible = false` is not enough for compile; use a separate off-screen scene sharing the same environment, or temporarily set `root.visible = true` while rendering to a 4×4 `WebGLRenderTarget`), call `renderer.compileAsync(scene, camera)`, render once to the small target, then remove. Also force texture upload: `renderer.initTexture(tex)` for every texture in the tier. Resolve when done.
- Material consistency: keep `MeshStandardMaterial` as produced by GLTFLoader; do not alter tone mapping or colour spaces (the stage owns those).
- Dispose geometry/textures/materials of a tier when the viewer replaces it (expose `disposeObject(root)` helper).

## Tests (Playwright, Chromium, with a tiny KTX2+meshopt fixture glb committed under `fixtures/` ≤ 100 KB produced by gltf-transform from a cube; and Vitest for the progress wrapper)

- `loadTier` resolves to an `Object3D` with ≥ 1 mesh; `onProgress` is monotonic and ends at `tier.bytes`.
- `warm` resolves; a subsequent first on-screen render of the tier takes < 8 ms measured with `performance.now()` around `renderer.render` (compare against an un-warmed load of the same fixture which must be slower — assert the ratio, not an absolute, to keep CI stable).
- Dispose test: `renderer.info.memory.geometries` and `.textures` return to the baseline after `disposeObject`.

## Out of scope

Tier policy (viewer), swapping (stage/viewer), proxy anything.

## Report

`docs/reports/P5-report.md` with warm vs cold first-render timings for the three sample L0/L1/L2 tiers on the owner's laptop.
