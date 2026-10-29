# P2 report — build-proxy

Status: done. 2026-10-29.

## What was built

`packages/build-proxy` exports one function, `renderProxyFrames(opts)` (see `src/render-proxy.ts` / `src/index.ts`), matching the brief's Input/Output contract exactly:

- Launches headless Chromium (Puppeteer) and points it at a bundled render page (`page/render-page.ts`, built standalone with esbuild into `dist/page/render-page.js`) that imports `@understudy3d/stage`'s `createStage` plus three.js `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`, so build-time frames are produced by the exact same camera/environment/tone-mapping code the live viewer uses (D-007).
- A tiny ephemeral Node `http` static server (`src/static-server.ts`) serves the page bundle, the three.js KTX2 transcoder (`basis_transcoder.js`/`.wasm`, resolved from `node_modules/three` via `createRequire(...).resolve`, not copied), and the input model's bytes — no external network.
- `StageParams` and the baked background colour are passed to the page via the URL (base64 JSON in a query param), so `window.__understudyRender` keeps exactly the three methods the brief names (`load`, `setView`, `snapshot`); `snapshot()` returns base64 PNG text rather than a literal `Uint8Array` over the wire (an internal choice — see Deviations) and the Node side decodes it to a `Buffer` and writes `frames/NNN.png`.
- Renders ring-major per §5.1: for ring `r`, frame `i`, global index `g = r·frames + i`; azimuth comes from `azimuthForFrameIndex(i, frames, azimuthStart)` (local `i`, not `g`) so multi-ring output stays correct, matching the design doc precisely. `camera.json`'s `perFrame[g].i === g` (the file-numbering index), with `azimuthDeg`/`elevationDeg` for that frame.
- `distance` is computed once via `@understudy3d/stage`'s `fitDistance(bounds.radius, stage.fovDeg)` and merged into the `StageParams` returned to the caller and written into `camera.json`.
- Renderer config per the brief: `antialias: true`, `preserveDrawingBuffer: true`, `setPixelRatio(1)`, background baked by setting `stage.scene.background` and the renderer's clear colour explicitly (not part of the frozen `Stage` API — build-proxy's own responsibility, same as the live viewer's own clear colour per §5.2). Two warm `stage.render()` calls after `renderer.compileAsync()` before the first snapshot, as specified.
- SwiftShader flags (`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`) are the default; `useGpu: true` in the options drops them to use the host GPU — an additive, optional field, not in the brief's literal `opts` type but backward-compatible with it. Also added `onProgress?(rendered, total)`, used for the measurements below.

## Stand-in input model (read first — see env-specific guidance in the task)

`packages/build-geometry` (P1) doesn't exist in this worktree, so there is no real L2-tier `.glb` to render. I used **`samples/Avocado.glb` as-is** (fetched via `pnpm run fetch-samples`) — option (b) from the task instructions: the brief's acceptance criteria are about frame-rendering correctness, not about consuming a genuine P1 tier, and Avocado uses plain PNG textures and uncompressed geometry, so it also exercises the "no KTX2/meshopt present" code path (the GLTFLoader/KTX2Loader/MeshoptDecoder wiring itself is otherwise unverified against a real compressed tier — see Open questions).

Avocado isn't P1-normalized (not centred at the origin), so I computed its real bounding sphere once, offline, by reading the `POSITION` accessor's `min`/`max` directly from the glb's JSON chunk (ignoring node transforms — fine for this single-mesh sample): `center = [0, 0.0314, 0]`, `radius ≈ 0.0404`. Tests pass `stage.target = bounds.center` instead of `[0,0,0]` so the camera looks at the model's actual centre; in production P1 supplies both `bounds` and a model already centred at the origin, so `target` would simply be `[0,0,0]` as the design doc shows.

## How to run it

```bash
pnpm install
pnpm run fetch-samples                       # samples/Avocado.glb etc.
pnpm -F @understudy3d/build-proxy run build
pnpm -F @understudy3d/build-proxy run typecheck   # clean
pnpm -F @understudy3d/build-proxy run test        # 6/6 passing
pnpm run test                                 # whole repo: 32/32 passing
```

```ts
import { renderProxyFrames } from '@understudy3d/build-proxy';

await renderProxyFrames({
  modelUrlOrPath: 'samples/Avocado.glb',
  outDir: 'out/avocado',
  size: 1024,
  frames: 72,
  ringsDeg: [20],
  azimuthStartDeg: 0,
  stage: {
    fovDeg: 35,
    target: [0, 0, 0],
    environment: 'studio-neutral',
    exposure: 1,
    toneMapping: 'aces',
  },
  background: '#ffffff',
  bounds: { center: [0, 0, 0], radius: 0.05 },
});
```

## Render times

72 frames, 1024×1024, Avocado.glb, measured end-to-end (browser launch + static server + model load/warm-up + all 72 renders + PNG encode + disk writes):

| Mode                               | Total  | Per-frame (steady state) |
| ---------------------------------- | ------ | ------------------------ |
| SwiftShader (default launch flags) | 10.7 s | ≈ 119 ms/frame           |
| `useGpu: true` (host GPU escape)   | 4.1 s  | ≈ 39 ms/frame            |

Both comfortably inside the brief's "~3 minutes" budget. Most of the SwiftShader total is fixed overhead (Chromium launch, 8 MB glTF parse, PMREM/KTX2Loader warm-up) rather than per-frame cost — the first 4 frames land at the ~2.1 s mark, after which frames arrive at a roughly constant rate.

## Contact sheet

`docs/reports/P2-contact-sheet.png` — 12 of the 72 SwiftShader frames (every 6th), 4×3 grid, labelled. Visually confirms a clean 360° orbit at a fixed 20° elevation, consistent framing/exposure across the full rotation, and an opaque white background baked into every frame.

## Test pass/fail counts

- `packages/build-proxy`: **6/6 passing** (`src/render-proxy.test.ts`, SwiftShader, ~5.7–6.8 s total):
  1. 8 PNGs written, each exactly 256×256 (decoded via a throwaway Puppeteer page + canvas, not a new Node PNG dependency).
  2. Mean colour of frame 000 vs frame 004 differs (object rotated).
  3. All four corner pixels of frame 000 are within 3/255 of opaque white (`#ffffff`, alpha 255) — background baked correctly.
  4. `camera.json`'s `azimuthDeg` round-trips through `azimuthForFrameIndex`/`degToRad` to within 1e-9 rad for every frame.
  5. Returned `StageParams.distance` is positive and `fovDeg` matches input.
  6. Determinism: two independent `renderProxyFrames` runs (separate browser launches, separate output dirs) produce byte-identical `000.png` under SwiftShader.
- Whole repo (`pnpm run test`): **32/32 passing** — cli 9, manifest 8, stage 9, build-proxy 6. No regressions in the packages this brief didn't touch.
- `pnpm run lint`: clean, repo-wide. `pnpm run typecheck`: clean, repo-wide.
- `pnpm run format`: **fails repo-wide at baseline**, including files this package never touched (e.g. `README.md`, `packages/cli/*`, `docs/*.md`) — a pre-existing Prettier/line-ending mismatch on this Windows checkout (verified by stashing all my changes and re-running; it already fails against `master @ b4d96a2`). Not a P2 regression; not something I fixed since it's outside this package and not part of the agent protocol's required gates (`test`/`typecheck`).

## Deviations from the brief

- **Root-level touches (not `manifest`/`stage`, but outside my package directory), both minimal and additive:**
  - `pnpm-workspace.yaml`: set `allowBuilds.puppeteer: true` (pnpm appended the key as `set this to true or false` on `pnpm install`; required to let Puppeteer's postinstall download Chromium at all).
  - `eslint.config.js`: widened the Node-globals override from `'scripts/**/*.mjs'` to `['scripts/**/*.mjs', '**/scripts/**/*.mjs', '*.config.js']` so `packages/build-proxy/scripts/build-page.mjs` (a per-package build script, same pattern as the root `scripts/` dir) gets `process`/`console` globals instead of `no-undef` errors.
- `window.__understudyRender.snapshot()` returns a base64 string across the Puppeteer/CDP boundary, not a literal `Uint8Array` — cheaper to serialize than a numeric-keyed array over CDP; the Node side still hands back real PNG bytes on disk, so the documented `renderProxyFrames` contract (the brief's actual Input/Output section) is unaffected. This is an internal implementation detail of the "Implementation notes" pseudo-interface, not the public contract.
- Added two optional fields to `opts` beyond the brief's literal type: `useGpu?: boolean` (the brief's own "flag `--gpu` to use the host GPU locally") and `onProgress?: (rendered, total) => void` (brief: "Expose progress callbacks"). Both optional, additive, non-breaking.
- Did not serve `outDir` over the static HTTP server. Nothing needs to fetch from it — frames are written straight to disk from the base64 PNG the page hands back over `page.evaluate`, so only the page bundle, the KTX2 transcoder, and the model bytes are actually served.
- PNG pixel assertions in tests decode through a throwaway Puppeteer page (`Blob` → `createImageBitmap` → `canvas.getImageData`) instead of adding a Node PNG-decoding package — Puppeteer is already a mandated dependency; this avoids a second new one.
- New dependencies: `puppeteer` (^23.11.1, Apache-2.0 — explicitly mandated by the brief and D-005) as a runtime dependency; `esbuild` (^0.21.5, MIT, dev-only — the brief names it explicitly as the page-bundler option, and it was already present transitively via Vitest) to bundle `page/render-page.ts` standalone; `@types/three` (dev-only, same version P0 already pinned) for typechecking the page code.

## Open questions

- `useGpu`/`onProgress` aren't wired to any CLI flag yet — `packages/cli` wiring is Wave 2 per `docs/02-plan.md`; whoever does that wiring should surface `--gpu` as the plan's §7 implies.
- The KTX2Loader/MeshoptDecoder wiring in `page/render-page.ts` is implemented per the three.js examples API but only exercised against Avocado's plain-PNG, uncompressed-geometry glb, since no real P1 KTX2/meshopt output exists in this worktree. Worth a follow-up render once `build-geometry` lands, to confirm the transcoder path (`/basis/basis_transcoder.wasm`) actually transcodes.
- The offline bounding-sphere computation used for the Avocado test fixture (raw accessor min/max, no node-transform handling) is good enough for this single-mesh sample but is not a substitute for P1's real bounds computation — don't reuse it for anything beyond this package's own tests.
