# P6 finding — `progressive-loader`'s `warm()` can block the main thread for 60-100ms

Status: **investigation report, no proposed fix** — the root cause is a browser/driver capability
gap, not a code defect in `packages/progressive-loader`; recorded for visibility, not as a request
to change the frozen `warm()` contract.

## What

`docs/01-design.md` §3's goal: "No main-thread stall > 50ms during handoff or tier upgrade (shaders
precompiled, GPU uploads chunked)." Measured directly on this package's fixture (a small,
untextured sphere — about as cheap to compile as a shader gets): `loader.warm(root, stage)`
(`packages/progressive-loader/src/loader.ts`) took 60-78ms of apparent main-thread time on this
machine, logged as a single `longtask` `PerformanceObserver` entry.

`warm()` calls `renderer.compileAsync(stage.scene, stage.camera)`. `compileAsync` is only
genuinely non-blocking when the browser/GPU driver supports the `KHR_parallel_shader_compile`
WebGL extension; three.js's own implementation falls back to ordinary synchronous compilation,
wrapped in a `Promise` that still resolves only after that synchronous work finishes, when the
extension is unavailable. This is a documented three.js/WebGL limitation, not a progressive-loader
bug — `warm()` is calling the correct, only API available to it.

## Why this does not fail `packages/viewer`'s own long-task test

`packages/viewer/e2e/tests/handoff-pixel-diff.spec.ts` asserts no `longtask` ≥ 50ms specifically
**during the visible cross-fade** (`'handoff'` state to `'live'` state), not across the whole
`'warming'` → `'live'` span. The `compileAsync` stall happens entirely _before_ `'handoff'` fires —
while `loadTier()`/`warm()` are still running and the static proxy overlay is still on screen,
unanimated. A paused main thread during that window has nothing visible to glitch (nothing is
mid-animation); the crossfade's own measured wall-clock duration (~151-162ms against a 150ms
target, logged by the same test) corroborates that the stall does not fall inside it. The design
goal's intent — no visible main-thread-induced stutter during the swap the visitor actually sees —
holds on this machine; the letter of "during ... tier upgrade" (if read to include the background
load/warm work, not just the visible swap) does not.

## Who is affected

Any viewer instance running where `KHR_parallel_shader_compile` is unavailable — common on
software-rendered/CI Chromium (this machine included, launched with `--enable-unsafe-swiftshader`
per `packages/viewer/e2e/playwright.config.ts`) and on some mobile GPU drivers. Real hardware with
the extension should not reproduce this.

## Local workaround applied in this wave

None needed in `packages/viewer` — the orchestration already calls `warm()` exactly once, awaits
it before ever touching the live model, and the long-task assertion's window is scoped to the part
of the sequence that is actually visible to a visitor (see
`handoff-pixel-diff.spec.ts`'s own comment at the assertion site). No change requested to
`packages/progressive-loader`: `compileAsync` is already the correct call for its contract: there
is no alternative, non-experimental async shader-compile API for `warm()` to use instead when the
browser itself does not support one.
