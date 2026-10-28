# P7 — demo app and benchmarks (Sonnet 4.6, Waves 2–3)

Read first: `docs/00-decisions.md` (D-005), `docs/01-design.md` §3 goals, §10, agent protocol in `docs/02-plan.md`. Depends on the viewer (P6) and the wired CLI.

## Goal

Two things hiring teams will actually open: a GitHub Pages demo that shows the difference, and a reproducible benchmark table.

## Part A — `apps/demo` (Vite, vanilla TS, no framework)

- Page layout: model picker (Avocado, BoomBox, WaterBottle), network note, two panes side by side: **Plain** (three.js `GLTFLoader` on the original `.glb`, same stage, same camera) and **Understudy** (`<understudy-viewer>`). Both panes show a live metrics strip: TTFV, TTI, time-to-live-3D, time-to-settled, bytes before first visual, bytes total, current state.
- "Reload both" button that re-fetches with `cache: 'reload'`. A "Simulate low-end device" toggle that passes policy overrides. A "Throttle hint" box explaining how to use DevTools throttling (we cannot throttle from the page).
- Static assets: `pnpm demo:assets` runs the CLI on the three samples into `apps/demo/public/models/<name>/`; outputs are git-ignored and built in CI before `vite build`. `base` configured for GitHub Pages project path.
- Accessibility basics: keyboard orbit (arrow keys) in live mode, `aria-label`s, reduced-motion disables the cross-fade (instant swap).
- No analytics, no external requests, no fonts from CDNs (system font stack).

## Part B — `bench/` (Playwright, Chromium)

- Script `pnpm bench` starts `vite preview`, launches Chromium, for each preset in §10 applies `Network.emulateNetworkConditions` via CDP, for each model (Avocado, BoomBox, WaterBottle) and mode loads `/?model=…&mode=plain|understudy&debug=1`, waits for `settled` (or plain's first render), reads `window.__understudyMetrics`, repeats 3×, takes medians.
- Writes `BENCHMARKS.md` (table per preset: model × mode × metrics) with commit hash, Chromium version, date, and the preset definitions. Also writes `bench/results/<timestamp>.json`.
- Fails (exit 1) if `understudy` TTFV > 500 ms or TTI > 3000 ms on `3g-fast` for any model, so the goal in §3 is enforced in CI.
- Records one short run as a Playwright video → convert with ffmpeg to **GIF** (`palettegen/paletteuse`, 12 fps, 720 px wide) at `docs/media/demo.gif` for the README. No MP4 output anywhere (D-004).

## Tests

- Vitest for the median/aggregation code and the markdown table renderer.
- Playwright smoke in CI: demo loads, both panes reach their final state on the fixture cube within 20 s on an unthrottled connection.

## Out of scope

Firefox/Safari automation (documented as manual), multi-page docs site.

## Report

`docs/reports/P7-report.md` with the first full `BENCHMARKS.md` numbers and the GIF.
