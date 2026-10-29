# Roadmap

Items deliberately out of scope for v1, collected from the design doc, decisions, and agent reports as they came up. Not ordered by priority.

## Performance

- **Code-split `apps/demo`** so the initial chunk needed before first paint is materially smaller than today's ~300 KB gzip (D-005e) — closes most of the gap between viewer-internal TTFV (593–605 ms, 3g-fast) and wall-clock TTFV (~2750 ms). Candidates: lazy-load `@understudy3d/viewer` only when the Understudy pane is about to mount (it already is a dynamic `import()`; the main chunk itself still pulls in three.js/the Plain pane eagerly), route-level splitting, or a leaner entry point for library consumers who don't need the demo's comparison UI at all.
- Re-run the full `bench/` sweep after any such change and update `BENCHMARKS.md`.

## 3D content and delivery

- **Multi-ring vertical scrub** — v1 ships one elevation ring (§5.2 `proxy.rings`); a second ring (or interpolation between rings) would let the proxy video follow vertical drag too, not just horizontal.
- **Shared texture tiers** — L0/L1/L2 are each a fully self-contained `.glb` (D-008), which duplicates texture bytes across tiers. A format that shares a base texture and layers detail deltas would cut total bytes at the cost of loader complexity.
- **WebGPU path** — the renderer is WebGL2-only today (`three.js` `WebGLRenderer`); a WebGPU backend would need `packages/stage` and `packages/progressive-loader` to both support it.
- **AV2 when browsers ship hardware decode** — same role AV1 plays today, once support is real; the manifest's `codec` enum (§5.2) would gain a value and `proxy-player`'s `selectProxyVariant` would try it first.

## Viewer / integration

- **`<understudy-viewer>` has no `policy`/`debug` attribute path** — only `createViewer()`'s own JS options expose `QualityPolicy` overrides and the debug metrics hook (confirmed in P6's own report). `apps/demo`'s "Simulate low-end device" toggle is consequently a no-op against the real custom element; P7b worked around it at the page level (`bench-hook.ts`) rather than touching the frozen `packages/viewer`. Worth deciding whether the element should grow a settable `policy` property, or whether consumers who need overrides are expected to call `createViewer()` directly instead of using the element.
- **Framework wrappers** (React/Vue/Svelte components around `<understudy-viewer>`) — v1 ships the raw custom element only.

## Tooling

- **Per-tier simplification overrides** — `understudy build` always uses `DEFAULT_TIERS` (ratios/texture sizes); there's no CLI flag to override them per model (P0b's report).
- **AR, animation playback inside the proxy** — both explicitly out of scope for v1 (§3 non-goals).

## Testing

- `bench/`'s full three-preset × three-model sweep takes ~25 minutes wall-clock (P7b's report) — fine for a manual/scheduled run, too slow for every PR. A lighter single-preset, single-model smoke variant could run in CI directly; the full sweep stays a manual `pnpm run bench`.
