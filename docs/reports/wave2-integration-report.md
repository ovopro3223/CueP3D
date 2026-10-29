# Wave 2 integration report

Status: done. 2026-10-29. Integrator: Fable (this session).

## What landed

`packages/viewer` (P6) and `apps/demo` (P7a), built in parallel by independent Sonnet agents in separate worktrees, merged into `master`. Both independently verified (typecheck/test re-run from clean worktrees) before merging — see their own reports (`docs/reports/P6-report.md`, `docs/reports/P7a-report.md`).

## P6's own findings, triaged and resolved

P6's investigation into the handoff found three real issues in packages it isn't allowed to edit (frozen `stage`/`progressive-loader`) and correctly raised change requests instead of touching them:

1. **`packages/stage` overlay double-tonemapping** — real, visible bug, fixed: `toneMapped: false` on the overlay quad material (one line). A proxy frame is already tonemapped once at build time; the live renderer was applying its tonemapping curve to it a second time.
2. **Handoff acceptance criteria were miscalibrated** (D-005d) — `docs/01-design.md`'s "<2% proxy-vs-live pixel diff" target was never achievable with lossy AV1 compression in the loop. P6 proved the handoff mechanism itself is exact (0.000% live-vs-ground-truth) and the 5.2% was ordinary codec noise. Split the goal into sync correctness (<0.5%) and visual continuity (<8%, informational). Also fixed a stale test title that still claimed "<2%" after the assertion itself had already been loosened to 8%.
3. **`compileAsync` can block the main thread 60-100ms** without `KHR_parallel_shader_compile` — correctly diagnosed as a browser/driver limitation outside this project's control, and correctly scoped the long-task goal to the visible cross-fade only (where it doesn't matter, since nothing is animating yet). No code change needed.

## Found only by running the real, merged system in a browser (not visible to either agent alone)

Wave 1's lesson repeated at a deeper layer: **running the actual combined product, not just each package's own tests, found three more real bugs** that no amount of isolated-worktree testing could have caught, because each needs _both_ sides of the integration to exist:

1. **`understudy-pane.ts`'s `@vite-ignore` dynamic import.** P7a's workaround for `packages/viewer` not existing yet (a non-literal import specifier + `@vite-ignore`, so Vite wouldn't hard-fail the whole dev session) stopped the pane from ever resolving the import **even after the real package existed** — browsers cannot resolve a bare specifier like `@understudy3d/viewer` natively; only Vite's import analysis can rewrite it, and `@vite-ignore` explicitly opts out of that. Fixed: plain literal `import('@understudy3d/viewer')`, now that it's real.
2. **The custom element didn't actually implement `Viewer`.** `UnderstudyViewerElement` stored the object `createViewer()` returns in a private field but never exposed `state`/`metrics`/`degraded` as public getters, and never forwarded the internal `ViewerImpl`'s events (it dispatches on itself, a separate `EventTarget`, not on the container element) onto the custom element. Every `el.addEventListener('statechange', ...)` a consumer could write — including the demo's own, coded correctly against the frozen §5.6 API — would silently never fire, and `el.metrics` would always throw. Fixed by making the element genuinely delegate/forward.
3. **The KTX2 transcoder files were never shipped.** `progressive-loader` documents that integrators must supply `basis_transcoder.{js,wasm}` at a configurable path; `apps/demo`'s asset-build script never copied them. Requesting a missing static file under Vite's dev server doesn't 404 — its SPA fallback serves `index.html` with **200 OK**, which the transcoder's own bootstrap code then tried to parse as JavaScript, hanging the whole tier-load/warm step forever with no error, no timeout, no console output. Diagnosed by adding temporary debug logging to `create-viewer.ts`/`progressive-loader`'s `loadTier` (reverted after), which narrowed it to inside `GLTFLoader.parse()`, then confirming via a direct `fetch()` of the transcoder URL that it returned HTML. Fixed in `build-assets.mjs`: copies `three/examples/jsm/libs/basis/*` into each model's own `basis/` folder (the path is resolved per-manifest, so each of the three demo models needs its own copy).
4. **The custom element had no CSS**, so it defaulted to `display: inline` and never acquired a real size — `createViewer`'s `clientWidth`/`clientHeight` reads on it (the "container") returned 0, giving a 1×1 canvas. The viewer's internal state machine reached `settled` correctly the entire time (metrics were accurate) while the visible canvas stayed invisible. Fixed with one CSS rule (`.viewport understudy-viewer { display: block; width: 100%; height: 100%; }`).

Also removed `verifyDepsBeforeRun: false` from `pnpm-workspace.yaml` (P7a's documented workaround for the viewer package not existing yet) now that `pnpm install` resolves cleanly.

## Verified live in a real browser, full pipeline, zero mocking

Built real demo assets via the actual CLI (`pnpm run demo:assets`), ran the dev server, loaded the page, and watched it end to end:

- Plain pane: three.js `GLTFLoader`, real render, ~200-350ms.
- Understudy pane, with the real `<understudy-viewer>`: `idle → proxy-loading → proxy-ready → warming → handoff → live → settled`, TTFV ~146-165ms, TTI ~146-165ms, time-to-live-3D ~485ms, time-to-settled ~699ms, bytes-before-first-visual ~150KB. Canvas correctly sized (468×468), avocado rendered correctly, zero console errors. Dragged to orbit post-handoff — `OrbitControls` responded correctly.

This is the first time the complete, real system — build pipeline, proxy player, progressive loader, viewer orchestration, and demo — has run together as a visitor would actually experience it, and it works.

## Full suite after this wave

```
pnpm run lint        # clean
pnpm run format      # clean
pnpm run typecheck   # clean, 10 packages + apps/demo
pnpm run test        # manifest 8, stage 9, proxy-player 28+22e2e, build-encode 29,
                      # build-geometry 21, progressive-loader 3, build-proxy 6,
                      # viewer 137+11e2e, cli 10, apps/demo 15 = 299 total, all passing
+ progressive-loader's separate test:browser: 3/3
node scripts/assert-free-codecs.mjs fixtures   # clean, 100 media + 127 source files
```

## What's left (per docs/02-plan.md)

- **P7b — benchmarks**: real `BENCHMARKS.md` numbers across network presets (3g-fast/4g/wifi) for all three models, now that there's a real system to measure.
- **P8 — final docs/CI**: README polish, `docs/architecture.md`, `docs/roadmap.md`, finalize `.github/workflows/ci.yml` (add the Pages deploy workflow), demo GIF.
