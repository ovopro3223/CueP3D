# P4 — proxy-player (Sonnet 5, Wave 1)

Read first: `docs/00-decisions.md` (D-004, D-009), `docs/01-design.md` §5.1, §5.2 (ProxyVariant), §5.4, §6, agent protocol in `docs/02-plan.md`. Fixtures: `fixtures/proxy-fixture.av1.mp4`, `.vp9.mp4`, `fixtures/avif/`.

## Goal

`packages/proxy-player`: given a proxy variant, make any frame index available as an image the stage can draw, as early as the network allows, with hardware AV1 decoding where the browser offers it, and royalty-free fallbacks everywhere else. This is the component that turns "a video" into "an interactive stand-in".

## API (frozen, §5.4)

`selectProxyVariant(variants)`, `createProxyPlayer(variant, baseUrl)` returning `ProxyPlayer` with `firstFrame`, `available`, `onAvailableChange`, `getFrame(i)`, `prefetch(center, radius)`, `bytesLoaded/bytesTotal`, `dispose()`.

## Milestones

A. **Whole-file WebCodecs path.** Fetch the MP4, parse with `mp4box.js` (`MP4Box.createFile()`, `onReady` → track info and `av1C`/`vp09` codec string, `setExtractionOptions`, `onSamples`), feed `EncodedVideoChunk`s to `VideoDecoder` configured from `isConfigSupported`. Build a sample index: for each frame, byte offset, size, `is_sync`, decode order = presentation order (all-intra-period encodes have no B-frames; assert `cts === dts` and throw otherwise). Implement GOP-aware random access: `getFrame(i)` → find the keyframe at or before `i`, decode forward to `i`, close intermediate frames unless they are within the prefetch window. LRU cache of decoded `VideoFrame`s with a configurable budget (default 24); `VideoFrame.close()` on eviction. `available` = `{0, frames−1}` once the file is parsed.
B. **Streaming.** Fetch with `ReadableStream`; append chunks to mp4box with `fileStart` offsets; `onReady` fires after `moov` (`+faststart` guarantees it is first); samples become available progressively; `available.to` advances with the last fully received GOP; `firstFrame` resolves after frame 0 decodes, typically after the first 20–40 KB. Report `bytesLoaded`.
C. **`<video>` fallback.** When `VideoDecoder` is absent or `isConfigSupported` is false for every video variant, use a hidden `HTMLVideoElement` with `preload="auto"`, `playsInline`, muted. `getFrame(i)` sets `currentTime = (i + 0.5) / fps`, awaits `requestVideoFrameCallback` (or `seeked`), returns the element itself as the `FrameImage` (the stage uploads it as a texture). Cap outstanding seeks to one; coalesce rapid requests to the latest index.
D. **AVIF sequence fallback.** `createImageBitmap(await fetch(url(i)).blob())` with the same LRU; probe AVIF support once with a 1×1 AVIF data URL. `available` is the full range immediately; `firstFrame` after frame 0.
E. **`selectProxyVariant`**: iterate variants in manifest order; for video variants build the codec string from the container (parse `moov` of the first few KB if needed, or accept the variant's `codec` + a default level string `av01.0.08M.08` / `vp09.00.31.08`) and call `VideoDecoder.isConfigSupported`, falling back to `HTMLVideoElement.canPlayType('video/mp4; codecs="…"')`; for sequences use the AVIF probe. Return the first supported variant or null.

## Constraints

- No H.264/H.265 codec strings anywhere, including tests and comments. Forbidden strings test as in P3.
- Browser-only package (ESM); no DOM access at import time so the viewer can SSR-import it.
- Memory: never hold more `VideoFrame`s than the budget; `dispose()` closes everything and aborts fetches.
- Keep `mp4box.js` as the only runtime dependency; justify anything else in the report.

## Tests (Playwright, Chromium; plus Vitest for pure logic)

- Vitest: GOP math — for `gop = 8`, `getFrame(13)` decodes exactly frames 8..13; LRU evicts least-recently used; `prefetch(70, 3)` wraps around to frames 69,70,71,0,1 (ring-aware).
- Playwright: load the AV1 fixture; `firstFrame` resolves; draw frames 0, 17, 71 to a canvas and OCR-free check: compare against reference PNGs of the numbered pattern (mean abs diff < 3 %). Streaming: throttle to 1.6 Mbps via CDP; assert `firstFrame` resolves before `bytesLoaded` reaches 25 % of `bytesTotal`.
- Playwright: force `VideoDecoder` undefined via `addInitScript` → `<video>` path yields frame 17 within 300 ms of request; force both off → AVIF path works; variant selection returns the AVIF variant.
- Dispose test: after `dispose()`, no pending fetches (`performance.getEntriesByType('resource')` stable) and `getFrame` rejects.

## Out of scope

Pointer handling, camera math, drawing (stage does that), any 3D.

## Report

`docs/reports/P4-report.md` with time-to-first-frame at 1.6 Mbps for the fixture, cache hit rates during a simulated 360° scrub, and which browsers were exercised.
