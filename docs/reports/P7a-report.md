# P7a report — apps/demo skeleton (Part A only)

Status: done. 2026-10-29.

## What was built

`apps/demo` — Vite + vanilla TypeScript, no framework, per the brief's Part A. Layout: model picker (Avocado/BoomBox/WaterBottle, not DamagedHelmet per D-005a), "Reload both" button (`cache: 'reload'`), "Simulate low-end device" toggle, a throttle-hint `<details>` explaining DevTools throttling, two side-by-side panes (Plain / CueP3D) each with its own live metrics strip, and a model-attribution line pulled from `samples/LICENSES.md`'s data (hardcoded in `src/models.ts`, not re-parsed).

- `src/plain-pane.ts` — **fully real**, no viewer dependency. Fetches `cuep3d.json`, reads `manifest.stage` (`@cuep3d/stage`'s `createStage`) so the Plain pane uses the _exact same camera/fov/environment/tone-mapping/background_ as CueP3D will. Fetches the raw, unoptimized original `.glb` (own `fetchWithProgress`, deliberately not importing `@cuep3d/progressive-loader` — Plain is meant to be the naive baseline everyone actually ships, not a consumer of this repo's own optimizations), parses it with three.js `GLTFLoader`, recenters it on its own bounding-sphere centre (translate only, matching §5.1's normalization), and renders through `OrbitControls`. Metrics are deliberately just **time to first render** and **bytes total** — no CueP3D-specific metric names forced onto it, per the brief.
- `src/cuep3d-pane.ts` — wired exactly against the frozen §5.6 API, **blocked** on `packages/viewer` not existing in this worktree (see below).
- `src/device-policy.ts` — pure, viewer-independent `resolvePolicyOverrides(simulateLowEnd)` producing a concrete low-end override object (`maxTier: 'L1'`, `proxyPreferWidth: 512`, `frameCacheBudget: 12`, per §6's own numbers), ready to hand to the real viewer once it exists.
- `src/orbit.ts` — pure `rotateCameraAroundTarget()`, the keyboard-orbit math; real three.js `OrbitControls` handles pointer drag, and arrow keys call this to nudge the camera by spherical delta (confirmed safe to mix: `OrbitControls.update()` re-derives its spherical state from the camera's actual position every call, so it reconciles rather than overwrites).
- `src/metrics.ts`, `src/fetch-with-progress.ts` — small shared utilities.
- `scripts/build-assets.mjs` + root `demo:assets` script — runs the real CLI (`packages/cli/dist/bin.js`) for all three models into `apps/demo/public/models/<slug>/` (git-ignored — the `.gitignore` entry already existed from Wave 0), then copies each raw sample `.glb` alongside as `original.glb` for the Plain pane. Auto-appends KTX-Software's default Windows install path to `PATH` for the `toktx` subprocess if it's reachable but not already on `PATH`, since this machine's shells don't have it by default.

## What's real and verified right now

Ran `pnpm run fetch-samples` then `pnpm run demo:assets` from the worktree root: the real CLI built all three models successfully (`build-encode: AV1 encoder = nvenc` — this machine's ffmpeg has no SVT-AV1, `auto` fell back correctly to NVENC, still AV1, still free per D-005). `node scripts/assert-free-codecs.mjs apps/demo/public/models` — **clean, 225 media files, 101 source files scanned.**

| model       | original .glb | av01@1024   | av01@512  | vp09@512  | avif@512  | L0/L1/L2                        |
| ----------- | ------------- | ----------- | --------- | --------- | --------- | ------------------------------- |
| Avocado     | 8,110,040 B   | 384,153 B   | 154,223 B | 90,931 B  | 328,044 B | 26,740 / 160,936 / 11,487,728 B |
| BoomBox     | 10,614,184 B  | 1,262,318 B | 360,117 B | 298,703 B | 680,944 B | 38,848 / 182,556 / 11,491,852 B |
| WaterBottle | 8,966,700 B   | 509,822 B   | 176,302 B | 102,038 B | 375,986 B | 28,848 / 172,008 / 11,424,740 B |

Verified the Plain pane against all three real built models in an actual browser (Chromium via the Browser pane tool), both `vite` dev server and the real production `vite build` → `vite preview` bundle:

- **Avocado**: renders correctly (recognizable textured mesh, correct white background matching `manifest.proxy.background`), state `rendered`, time-to-first-render 180–203 ms, bytes total 7.74 MB (matches the raw file).
- **BoomBox**: renders correctly, 242–286 ms, 10.12 MB. Keyboard orbit confirmed — focused the viewport, pressed `ArrowRight` ×6, camera visibly rotated around the model.
- **WaterBottle**: renders correctly, 355 ms, 8.55 MB.
- Model-switch, "Reload both" (confirmed via network log: a second `cuep3d.json`/`original.glb` request pair fires on click), and the low-end toggle (no-op for Plain, doesn't throw) all work.
- `pnpm --filter @cuep3d/demo run typecheck/lint/test` and root `pnpm run lint`/`pnpm run test` all pass; `pnpm run build` (root, recursive) succeeds for every package including `apps/demo`'s own `vite build` (650 KB / 165 KB gzip single chunk — three.js's natural size, not code-split, fine for a demo).

## Blocked on `packages/viewer` — exactly what, and why

`packages/viewer` does not exist in this worktree (a separate agent owns it in its own worktree, not done yet, per the task). `apps/demo/package.json` declares `"@cuep3d/viewer": "workspace:*"` — the real dependency, added last, after everything else was verified working, so the wiring is complete and correct the moment that package lands and `pnpm install` can resolve it.

Consequences, precisely:

- **`pnpm install`** at the repo root now fails (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`) until `packages/viewer` exists. Confirmed this failure is clean/non-destructive (no lockfile or `node_modules` changes) in an isolated sandbox before doing it for real.
- **pnpm's `verify-deps-before-run`** (default `"install"`) means _any_ `pnpm run <script>`, in _any_ package — not just `apps/demo` — auto-runs `pnpm install` first, which then fails and blocks that command too. This was a real, repo-wide blast radius I didn't anticipate until I hit it: even `pnpm --filter @cuep3d/manifest run test` broke. Fixed with one `pnpm-workspace.yaml` line, `verifyDepsBeforeRun: false` (commented inline with why) — confirmed this restores every other package's own `pnpm --filter <pkg> run ...` commands. **Remove this once `packages/viewer` exists**; it's a temporary workaround for this exact window, not a permanent repo policy.
- **`tsc --noEmit`** fails with exactly one `TS2307: Cannot find module '@cuep3d/viewer'` at `cuep3d-pane.ts:1` (the `import type { Viewer }`). Verified this is the _only_ typecheck error in the whole package — every other file is clean.
- **`vite build`** (production bundle) actually **succeeds** — not blocked. The dynamic `import()` of the viewer uses a non-literal specifier + `/* @vite-ignore */` (needed below for a dev-server issue, and it has the side effect of making Rollup leave the specifier alone instead of hard-failing the build), so the resolution failure is deferred to runtime, where it's caught and degrades gracefully. Verified the real production build (`vite build` → `vite preview`) in a browser: Plain pane renders correctly, CueP3D pane shows a clear "blocked on packages/viewer" state, zero console errors.
- **`vite dev`** needed two fixes to not crash the _whole_ dev server (not just the CueP3D pane) on startup/first load: `optimizeDeps.exclude: ['@cuep3d/viewer']` in `vite.config.ts` (otherwise Vite's dependency-scan crawls the dynamic import at startup and the dev server never comes up), and the non-literal specifier + `@vite-ignore` above (a literal string specifier still gets eagerly resolve-checked by Vite's import-analysis plugin even inside `try/catch`, which threw a full-page error overlay covering both panes, not just CueP3D's). Neither is a stub of the viewer's behavior — both just stop the bundler from statically chasing a module that's genuinely supposed to be resolved at runtime.

Runtime behavior once blocked: `mountCueP3DPane()` catches the failed dynamic import, renders a visible "Blocked on packages/viewer (not available in this worktree): …" message in the pane, sets all its metrics to `—`, and the `CueP3DPaneHandle` methods (`setModel`/`reload`/`setPolicyOverrides`) become no-ops — confirmed this never throws or breaks the Plain pane alongside it, including across model switches and reloads.

No fake shim of the viewer's API was written anywhere, per the instructions.

## "Simulate low-end device" toggle

Implemented as a real checkbox wired to `resolvePolicyOverrides()`, which produces a concrete override object and calls `cuep3dPane.setPolicyOverrides(overrides)`. The CueP3D pane sets it as `el.policy = { ...overrides, reducedMotion }` on the custom element before every `(re)mount`. This is a no-op for the Plain pane (no tiering/policy concept exists there), which is correct per the brief.

## Deviations / assumptions (open questions for whoever lands `packages/viewer`)

1. **`<cuep3d-viewer>.policy` as a settable JS property**, not an HTML attribute. §5.6 only documents `policy` on the `createViewer()` JS options object, not how the custom-element form receives a non-string value. Standard web-component practice (attributes for primitives, properties for objects) — but unconfirmed against the real element. One-line fix in `cuep3d-pane.ts` if wrong.
2. **`reducedMotion` folded into the `policy` object** sent to the element. §5.6 doesn't document a dedicated "disable crossfade" hook; `prefers-reduced-motion` otherwise only disables the Plain pane's `OrbitControls` damping and the demo chrome's own CSS transitions (both real, both verified). If the real viewer has no such hook, this is silently ignored rather than broken — but it means §6's "instant swap" reduced-motion requirement isn't actually honored by the real handoff yet. Worth a one-line note in P6's own report/brief if it doesn't already have one.
3. **GitHub Pages `base`** assumed `/cuep3d/` (`CUEP3D_DEMO_BASE` env override available) — D-002 fixed the npm scope, not the GitHub repo name.
4. **Proxy background hardcoded `#ffffff`** in `main.ts` for the CueP3D pane's `background` attribute (all three demo models' manifests do use `#ffffff`), rather than fetching the manifest a second time on the demo side just for this one field.

## Other deviations

- Added `jsdom` as a devDependency (MIT) to unit-test `metrics.ts`'s DOM rendering (`document.createElement`) with Vitest — the only package in the repo that needed a DOM test environment at the unit level.
- Added `.claude/launch.json` (Browser-pane dev convenience, not part of the brief) — harmless, not required reading.
- Found and fixed a real bug during review: `OrbitControls` wasn't disposed on model switch in `plain-pane.ts`, which would have accumulated duplicate pointer/wheel listeners on the canvas after repeated model switches.

## Verification commands

```
pnpm run fetch-samples          # from worktree root
pnpm run demo:assets            # builds all three models into apps/demo/public/models/
pnpm --filter @cuep3d/demo run typecheck   # 1 expected TS2307 (cuep3d-pane.ts only)
pnpm --filter @cuep3d/demo run test        # 15/15 passing
pnpm --filter @cuep3d/demo exec eslint .   # clean
pnpm --filter @cuep3d/demo run build       # succeeds (650 KB / 165 KB gzip)
pnpm --filter @cuep3d/demo run dev         # serves at /cuep3d/
node scripts/assert-free-codecs.mjs apps/demo/public/models   # clean
```

## Not done (Part B, out of scope here)

`bench/` (Playwright network-throttled measurements, `BENCHMARKS.md`, the demo GIF) — explicitly deferred per the task; needs the real viewer to be benchmarkable.
