# P7b report — `bench/` (Part B only)

Status: done. 2026-10-29. Real sweep, real GIF, real failures reported honestly (D-005d).

## What was built

- **`bench/`** — a new workspace package (TypeScript strict/ESM, Vitest + Playwright, matching every
  other package's conventions). `src/presets.ts` (the three §10 CDP presets), `src/server.ts`
  (`vite build` + `vite preview` via Vite's own JS API — no `pnpm`/`vite` subprocess, so no Windows
  `.cmd` shell-resolution risk), `src/run-case.ts` (one throttled page load, polls
  `window.__understudyState`/`__understudyMetrics` to the mode's terminal state), `src/median.ts`,
  `src/markdown-table.ts`, `src/goals.ts` (the §3 CI gate), `src/sweep.ts` (orchestrates
  3 presets × 3 models × 2 modes × 3 runs), `src/bin/bench.ts` (`pnpm run bench`, writes
  `BENCHMARKS.md` + `bench/results/<ts>.json`, exits 1 on a goal violation), `src/bin/record-gif.ts`
  (`pnpm run bench:gif`), `bench/e2e/smoke.spec.ts` (fast, unthrottled, one model — this is what
  `pnpm test` runs; the full sweep is a separate, slow `pnpm run bench`, per the brief).
- **`apps/demo` additions** (Part A's structure untouched): `src/bench-hook.ts` (new file —
  `window.__understudyMetrics`/`__understudyState`, mirroring `ViewerMetrics`), plus an `onUpdate`
  hook added to `PlainPaneOptions`/`UnderstudyPaneOptions` and `?model=&mode=plain|understudy&debug=1`
  query-param handling in `main.ts`. Needed because `<understudy-viewer>` doesn't actually forward
  `debug`/`policy` into `createViewer()` — P6's own report says this is intentional
  (`custom-element.ts`: "`src`/`background` attributes only; policy overrides and `debug` stay
  JS-API-only"), so `apps/demo/src/understudy-pane.ts`'s `el.policy = {...}` is a silent no-op against
  the real element. Worked around it the faithful way: listen to the element's already-forwarded
  `statechange`/`metrics` events (confirmed working) instead of touching `packages/viewer`.
- New devDependencies in `bench/`: `vite` (drives the production server directly — justified above),
  `@playwright/test`/`playwright` (matches `packages/viewer`'s `^1.64.1`, already downloaded on this
  machine), `typescript`/`vitest` (every other package's own versions).

## Real measured numbers

Full table: `BENCHMARKS.md` (repo root). Commit `c7d4369`, Chromium 156.0.8078.4, 2026-10-29. Medians
of 3 runs/cell, all 54 cases real (no mocking, no throttle-the-encode trick — real CDP
`Network.emulateNetworkConditions`).

| Preset  | Model       | Plain TTFV | Understudy TTFV | Understudy TTI | Speedup (TTFV) |
| ------- | ----------- | ---------- | --------------- | -------------- | -------------- |
| wifi    | Avocado     | 2457 ms    | 476 ms          | 476 ms         | 5.2x           |
| 4g      | Avocado     | 7611 ms    | 498 ms          | 498 ms         | 15.3x          |
| 3g-fast | Avocado     | 41229 ms   | **598 ms**      | 757 ms         | **68.9x**      |
| 3g-fast | BoomBox     | 53871 ms   | **605 ms**      | 1270 ms        | **89.0x**      |
| 3g-fast | WaterBottle | 45568 ms   | **593 ms**      | 848 ms         | **76.8x**      |

## Were the §3 goals met?

**TTI: yes**, comfortably (757/1270/848 ms, all ≤ 3000 ms). **TTFV: no** — all three models land at
593–605 ms on 3g-fast, 19–21% over the 500 ms budget. `pnpm run bench` correctly exits 1 and prints
this. This is the measurement, not a tuning target to chase (D-005d's own precedent): I did not relax
the CDP throttle, pick an easier model, or change `goals.ts`'s threshold to make it pass.

**One open question this raises, by design, not by accident**: `TTFV`/`TTI` in `window.__understudyMetrics`
are timed from `createViewer()`'s own construction (`packages/viewer/src/metrics.ts`'s `t0`), which
excludes however long the page's ~300 KB-gzip JS bundle took to fetch/parse/execute first — and for
Understudy specifically, a _second_, dynamically-imported chunk (`understudy-pane.ts`'s
`import('@understudy3d/viewer')`) on top of that. I added a second measurement, `Wall TTFV`/`Wall TTI`
(same two marks, timed from `page.goto()` instead — what a real visitor's clock shows), in both
`BENCHMARKS.md` and the JSON. On 3g-fast, wall-clock TTFV is **~2750 ms**, not 598 ms — the bundle
download dominates under heavy throttling. §3 says "TTFV ≤ 500 ms … after HTML parse", which is
genuinely ambiguous between these two readings. I did not resolve this myself (it changes what the
project's own headline goal means); both numbers are reported so whoever owns §3 can decide.

## GIF

`docs/media/demo.gif` — 720×720, 12 fps, ~6.5 s, 1.4 MB. Avocado, Understudy pane only, wifi preset
(not 3g-fast: that preset's real settle time is ~64 s, too long for a README clip — wifi still shows
real network-throttled behavior, just not the slowest one). Shows: blank → proxy frame appears
(~470 ms) → a real pointer drag rotates the model ~35° (azimuth math from
`packages/viewer/src/scrub.ts`, calibrated so the final frame stays recognizable, not rotated out of
view) → holds through the handoff to `settled`. Verified by extracting and viewing frames directly,
not just trusting ffmpeg's exit code — an earlier take scrubbed too early (before TTFV) and recorded a
blank canvas; fixed by polling `window.__understudyState` past `proxy-loading` before dragging.

## Deviations

- Added `Wall TTFV`/`Wall TTI` columns beyond the brief's literal table spec (see above) — additive,
  doesn't change the brief's required columns.
- `apps/demo`'s `main.ts`/`plain-pane.ts`/`understudy-pane.ts` gained the query-param + `onUpdate`
  hook described above; no change to layout, panes, or default (no-query-param) behavior, verified in
  the Browser pane before building the harness against it.
- `bench/` forces `UNDERSTUDY_DEMO_BASE=/` for its own internal `vite build`/`preview` (bench URLs stay
  `/?model=…` instead of `/understudy/?model=…`) — set via `process.env` before `vite.config.ts` loads,
  not via a shell env var, to dodge Git Bash's `/`-path-mangling on Windows. No effect on the real
  GitHub Pages build, which sets its own value in CI.
- A `pnpm run bench 2>&1 | tee log` invocation (used once, while developing) reports the `tee` stage's
  exit code (0), not `pnpm`'s (1) — a shell-pipeline artifact of my own ad hoc invocation, not a bug in
  `bin/bench.ts` (confirmed: its own `[ELIFECYCLE] … exit code 1` and the printed violations were both
  present in that run's log). Plain `pnpm run bench` propagates the real exit code.

## Open questions (not decided here)

1. **Does §3's TTFV goal mean viewer-internal or wall-clock-from-navigation?** See above — real
   numbers for both are now in `BENCHMARKS.md`.
2. **`.github/workflows/ci.yml` never runs `demo:assets`** (only `fetch-samples`), so `pnpm run test`
   — which now includes `bench`'s e2e smoke test — will fail on a clean CI checkout. Fix is one step
   (`pnpm run demo:assets` after `fetch-samples`, before the test step); left unmade since `.github/`
   is outside this task's `bench/` + `apps/demo` scope.
3. **`<understudy-viewer>`'s "Simulate low-end device" toggle is a confirmed no-op** (policy/debug are
   JS-API-only by P6's own design, P7a's `el.policy = {...}` assumption doesn't reach it). Not fixed
   here (`packages/viewer` is outside this task's scope); worth a decision on whether the demo should
   call `createViewer()` directly for that toggle, or whether the custom element should grow a
   `policy` property.
4. Full three-preset × three-model sweep takes ~25 min wall-clock on this machine (3g-fast alone is
   ~20 min of that, dominated by Understudy's `settled` requiring all of L0+L1+L2 — each a complete
   `.glb` per D-008 — to finish downloading, ~11.2–11.5 MB, over a simulated 1.6 Mbps link). Fine for
   a manual/scheduled run; too slow for every PR.
