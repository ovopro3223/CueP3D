# Roadmap

Items deliberately out of scope for v1, collected from the design doc, decisions, and agent reports as they came up. Not ordered by priority.

## Performance

- ~~**Code-split `apps/demo`**~~ — done in D-014: both panes are dynamic imports, three.js is one shared chunk, the viewer imports `@cuep3d/progressive-loader` lazily, and the CueP3D path's chunks are `modulepreload`ed from the HTML. Wall-clock TTFV on 3g-fast went from ~2750 ms to 1803–1830 ms. What remains on that path is three.js itself (~134 KB gzip) plus the viewer and mp4box (~57 KB gzip): a smaller renderer core would be the next step, not more splitting.
- **Let the host page remove the last round trip.** Since D-014 the first visual costs exactly one request (the manifest, with frame 0 inline). A host that already knows the model could inline `cuep3d.json` into its HTML or `<link rel="preload" as="fetch">` it; `createViewer` would need to accept a manifest object (or read the preload cache) for that. Deliberately not counted toward §3's number — it changes what is measured, not the mechanism (D-014).
- **The benchmark renders WebGL in software.** Playwright's headless Chromium reports `ANGLE … SwiftShader Device (Subzero)`; the PMREM environment costs ~550 ms of GPU-process time there (tens of ms on a real GPU), and it is a main-thread stall because that compositor path reads the canvas back with `ReadPixels`. D-014 moved it off every §3 mark, but `Time to live` still carries it. A run on a GPU-backed Chromium would be a useful second column.
- Re-run the full `bench/` sweep after any change on these paths and update `BENCHMARKS.md`.

## 3D content and delivery

- **Multi-ring vertical scrub** — v1 ships one elevation ring (§5.2 `proxy.rings`); a second ring (or interpolation between rings) would let the proxy video follow vertical drag too, not just horizontal.
- **Shared texture tiers** — L0/L1/L2 are each a fully self-contained `.glb` (D-008), which duplicates texture bytes across tiers. A format that shares a base texture and layers detail deltas would cut total bytes at the cost of loader complexity.
- **WebGPU path** — the renderer is WebGL2-only today (`three.js` `WebGLRenderer`); a WebGPU backend would need `packages/stage` and `packages/progressive-loader` to both support it.
- **AV2 when browsers ship hardware decode** — same role AV1 plays today, once support is real; the manifest's `codec` enum (§5.2) would gain a value and `proxy-player`'s `selectProxyVariant` would try it first.

## Viewer / integration

- **`<cuep3d-viewer>` has no `policy`/`debug` attribute path** — only `createViewer()`'s own JS options expose `QualityPolicy` overrides and the debug metrics hook (confirmed in P6's own report). `apps/demo`'s "Simulate low-end device" toggle is consequently a no-op against the real custom element; P7b worked around it at the page level (`bench-hook.ts`) rather than touching the frozen `packages/viewer`. Worth deciding whether the element should grow a settable `policy` property, or whether consumers who need overrides are expected to call `createViewer()` directly instead of using the element.
- **Framework wrappers** (React/Vue/Svelte components around `<cuep3d-viewer>`) — v1 ships the raw custom element only.
- **Decoder continuation without `flush()`** — `proxy-player`'s WebCodecs player decodes every request from its GOP keyframe (D-013): the original "continue with the next delta frame" shortcut was invalid because each batch ends with `flush()`, after which WebCodecs demands a key chunk. Waiting for the target frame's output callback instead of flushing would make sequential scrubbing one decode per step rather than up to `gop` decodes, at the cost of tracking in-flight outputs per request.

## Tooling

- **Per-tier simplification overrides** — `cuep3d build` always uses `DEFAULT_TIERS` (ratios/texture sizes); there's no CLI flag to override them per model (P0b's report).
- **AR, animation playback inside the proxy** — both explicitly out of scope for v1 (§3 non-goals).

## Testing

- `bench/`'s full three-preset × three-model sweep takes ~25 minutes wall-clock (P7b's report) — fine for a manual/scheduled run, too slow for every PR. A lighter single-preset, single-model smoke variant could run in CI directly; the full sweep stays a manual `pnpm run bench`.
