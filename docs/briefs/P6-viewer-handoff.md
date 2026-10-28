# P6 — viewer and handoff (Sonnet 5, Wave 2)

Read first: `docs/00-decisions.md`, `docs/01-design.md` §5 (all), §6, §8, agent protocol in `docs/02-plan.md`. Depends on the landed APIs of `proxy-player` (P4), `progressive-loader` (P5), `stage` and `manifest` (P0).

## Goal

`packages/viewer`: the orchestrator. One WebGL canvas, one state machine, the QualityPolicy, pointer handling in both modes, the camera-synchronized cross-fade, tier upgrades without flicker, metrics, and the `<understudy-viewer>` custom element.

## API (frozen, §5.6)

`createViewer(container, { src, policy?, background? })` → `Viewer` with `state`, `degraded`, `metrics`, events `statechange` / `metrics` / `error`, `dispose()`. Custom element `understudy-viewer` with attributes `src`, `background`.

## Behaviour

1. Fetch + validate the manifest (`@understudy3d/manifest`). Create renderer (`antialias`, `alpha: false`, `powerPreference: 'high-performance'`), clear colour = `manifest.proxy.background`, `createStage(renderer, manifest.stage)`. Resize with `ResizeObserver`; DPR capped at 2.
2. `QualityPolicy.choose()` (pure function, unit-tested) → `{ proxyVariant | null, maxTier, downloadMode, cacheBudget }` from: `selectProxyVariant`, canvas CSS width × DPR, `navigator.connection?.{effectiveType,downlink,saveData}`, `navigator.deviceMemory`, `hardwareConcurrency`, `WEBGL_debug_renderer_info` string (heuristic list of low-end GPU substrings), `prefers-reduced-data`. Options allow overriding every input (for tests and the demo's "simulate low-end" toggle).
3. Proxy mode: start the player; on `firstFrame` → `stage.setOverlayFrame(frame)`, mark TTFV (`performance.mark('understudy:ttfv')`), state `proxy-ready`, mark TTI when `available` covers ≥ 3 GOPs around the current index or the whole range. Pointer: `pointerdown/move/up` + touch, horizontal delta → θ per §5.1, request `getFrame(index)`, prefetch ±4 in the drag direction; vertical drag ignored in v1 (single ring). Show frames only in increasing-recency order (drop stale resolves).
4. Tier loading per `downloadMode`: `serial` waits for the player's `bytesLoaded === bytesTotal` before starting L0; `parallel` starts L0 immediately. Each tier: `loadTier` → `warm` → ready.
5. Handoff: when L0 is warm and the handoff rule in §6 holds (not mid-fast-drag; wait ≤ 1 s), `stage.setView(θ_current, φ_ring)`, `stage.setModel(L0)`, animate `setOverlayOpacity` 1 → 0 over 150 ms with `requestAnimationFrame`, then `setOverlayFrame(null)`, dispose the player, state `live`, mark `ttLive`. Enable `OrbitControls` (damping on, `rotateSpeed = 1`, zoom limits from `bounds.radius`), initialized to the same spherical coordinates so the first controls frame is identical.
6. Upgrades: when `L1`/`L2` are warm, swap on the next frame via `stage.setModel`, dispose the previous tier (`disposeObject`), state `upgrading` → `live`; after the last allowed tier, `settled`, mark `ttSettled`.
7. Degraded path: no usable proxy → state goes `proxy-loading` → (skip) → start L0 immediately; show nothing but the background until L0 is warm, then `live` (TTFV = ttLive). Optional poster: if the manifest's AVIF sequence exists but the policy rejected video, show frame 0 only.
8. Errors per §8. Context loss: `webglcontextlost` → preventDefault, rebuild on `webglcontextrestored`, restore the current tier and view.
9. Metrics object updated with `performance.now()` deltas from `createViewer`; `bytesBeforeFirstVisual` = proxy bytes at TTFV (or L0 bytes in degraded mode); `bytesTotal` cumulative. Emit `metrics` on every change. Expose `window.__understudyMetrics` only when `options.debug` is true (the bench reads it).

## Tests

- Vitest: `QualityPolicy.choose` table-driven (12+ cases: slow 3G phone → 512 proxy, max L1, serial, small cache; desktop wifi → 1024, L2, parallel; `saveData` → serial and L1; no proxy support → `proxyVariant: null`).
- Vitest: state machine transitions are the only ones allowed (reducer-style, exhaustive).
- Playwright (Chromium) against a fixture output directory committed under `fixtures/out-cube/` (built once by the CLI from the cube glb; small): reaches `live` then `settled`; `statechange` order is exactly `proxy-loading, proxy-ready, warming, handoff, live, upgrading, live, settled` (adjusted for the fixture's tier count).
- Playwright handoff pixel test: at `proxy-ready`, scrub to frame 17, freeze, force handoff, capture the canvas on the last proxy frame and on the first live frame → mean abs diff < 2 %. Also assert no `longtask` entry ≥ 50 ms between `warming` and `live`.
- Playwright fallback: `addInitScript` removing `VideoDecoder` → still reaches `live`; removing AV1 + VP9 support → AVIF path; removing everything → `degraded === true`, still reaches `live`.
- Dispose: no leaked `requestAnimationFrame`, listeners, or WebGL resources (`renderer.info.memory` at baseline).

## Out of scope

Framework wrappers, AR, animation, multi-ring vertical scrubbing (roadmap), analytics.

## Report

`docs/reports/P6-report.md` with the handoff diff numbers for the three samples, long-task counts, and a short note on every QualityPolicy threshold chosen and why.
