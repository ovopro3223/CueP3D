# P4 report — proxy-player

Status: done. 2026-10-29.

## What was built

`packages/proxy-player`: decodes a selected `ProxyVariant` and makes any frame index
available as a `FrameImage`, as early as the network allows, with hardware AV1/VP9
decoding where the browser offers it and two royalty-free fallbacks everywhere else.

- `selectProxyVariant(variants)` (§5.4, unchanged signature): probes capability per
  manifest-ordered variant — `VideoDecoder.isConfigSupported` first (using the brief's
  documented default level strings, since this function has no `baseUrl` to fetch the
  real container with), falling back to `<video>.canPlayType`; AVIF variants via a
  one-time `<img>` decode of a known-valid 1×1 AVIF.
- `createProxyPlayer(variant, baseUrl)` (§5.4, unchanged signature): dispatches to one
  of three implementations.
- **Milestones A+B — WebCodecs (`webcodecs-player.ts` + `mp4-source.ts`).** One
  implementation serves both: streaming is the general case, "whole-file" is simply
  the case where every byte has already arrived by the time something is requested.
  `mp4-source.ts` streams the MP4 through mp4box.js; sample *metadata* (every frame's
  offset/size/sync flag/timing) is read from `moov` the instant it parses — ISOBMFF's
  sample tables describe the whole file regardless of how much of `mdat` has
  downloaded — so the exact GOP and frame count are known immediately, before any
  frame data streams in. `getFrame(i)` finds the keyframe at or before `i`, decodes
  forward through a single persistent `VideoDecoder`, and takes an O(1) fast path when
  the decoder is already positioned at `i-1` in the same GOP (the common case while
  scrubbing smoothly) rather than re-decoding the GOP prefix every call. `cts === dts`
  is asserted per sample (all-intra, no B-frames) and throws otherwise. Decoded
  `VideoFrame`s live in an LRU (default budget 24) that never evicts a frame inside the
  current prefetch window or an in-flight target; `VideoFrame.close()` discipline is
  enforced in the eviction callback. `available` is quantized to whole received GOPs.
- **Milestone C — `<video>` fallback (`video-element-player.ts`).** A hidden,
  muted `HTMLVideoElement`. Seek targets come from the exact per-frame `cts`/timescale
  read via a lightweight moov-only probe (not an assumed fps — see Deviations), landed
  at the midpoint of each frame's display interval. Outstanding seeks are capped to
  one; rapid requests coalesce to the latest index without resolving stale callers with
  a stale frame (the loop only settles queued callers once nothing newer arrived while
  it was seeking).
- **Milestone D — AVIF sequence (`avif-sequence-player.ts`).** `createImageBitmap`
  per frame with the same LRU shape; concurrent requests for an unfetched index share
  one in-flight promise rather than double-fetching.
- **Milestone E — `selectProxyVariant`** as above.
- `gop.ts` / `lru-cache.ts`: pure, dependency-free logic (GOP math, ring-aware prefetch
  windows, generic LRU with a protected-key predicate), fully Vitest-covered.

## Test results

- **Vitest (unit, pure logic): 28/28 passing** — `gop.test.ts` (19: keyframe/decode-range
  math, ring-window wraparound, GOP-range merging, GOP-boundary availability) and
  `lru-cache.test.ts` (9: LRU eviction, recency, the protected-key predicate and its
  overflow edge case, and — a real bug this caught — closing the old value when a key
  is overwritten with a different one).
- **Playwright (Chromium, real fixtures): 22/22 passing** — `fixture-decode.spec.ts`
  (AV1 + VP9 whole-file decode, GOP-aware random access, cross-GOP scrubbing),
  `streaming.spec.ts` (throttled 1.6 Mbps), `fallback-chain.spec.ts` (`<video>` and AVIF
  paths forced via `addInitScript`/`canPlayType` stubbing, plus `selectProxyVariant`
  under the same constraints), `dispose.spec.ts` (all three player kinds),
  `benchmark.spec.ts` (measurements below).
- Correctness method for "decoded frame N, not just some frame": each test decodes
  frame N and compares it (RGB channels, OffscreenCanvas `getImageData`) against a
  freshly ffmpeg-regenerated ground truth for that exact index (same `testsrc2` +
  `drawtext` graph `scripts/make-fixtures.mjs` used), then separately compares the same
  decoded frame against a reference from the *opposite side of the 72-frame orbit*.
  Measured on this fixture: a correct decode sits around 4% mean abs diff (AV1
  compression noise against the regenerated source, not an error); a wrong-index
  comparison reads 10%+. That gap, not an arbitrary absolute number, is the actual
  proof. (An adjacent-frame comparison was tried first and discarded — `testsrc2`
  moves continuously, so frame *i* and *i+1* are too similar to each other for an
  off-by-one bug to show up reliably; comparing against the far side of the ring does.)
- Browsers exercised: Chromium only (Playwright's bundled build), per the brief's test
  list. Not checked in Firefox/Safari.

## Measured numbers

- **Time-to-first-frame, AV1 fixture, throttled to 1.6 Mbps (3g-fast per §10):
  ~184-187ms**, with only ~4.4% of the file (5.4 KB of 122 KB) downloaded at that point
  — comfortably inside the brief's "< 25% of bytesTotal" bound and the design's 500ms
  TTFV goal, for a tiny proxy; real-world proxies and RTT will differ.
- **Cache hit rate across a simulated full 360° scrub** (72 frames, `prefetch(center,
  3)` called after every `getFrame`, no delay between steps): **54.2% (39/72)**.
  Reported as measured rather than tuned to look better: back-to-back synchronous
  stepping doesn't give an async prefetch decode time to finish before the very next
  frame demands it; a real pointer-drag has natural per-frame gaps that would let more
  prefetched decodes complete first.

## Deviations from the brief / frozen API

- **No deviation from the frozen `selectProxyVariant`/`createProxyPlayer` signatures.**
  Everything else below is implementation detail, not a contract change.
- `selectProxyVariant` uses the brief's default level strings (`av01.0.08M.08` /
  `vp09.00.31.08`) exclusively, never the exact per-file profile/level — it has no
  `baseUrl` to fetch the real container with (single-argument, per §5.4). `createProxyPlayer`,
  which does have `baseUrl`, resolves the *exact* codec string from the real file's
  `av1C`/`vpcC` box before configuring `VideoDecoder`. In the normal flow these two run
  together, so the common case already gets the precise check; the brief explicitly
  allows the default-string path, this just doesn't use it in the one place it can
  afford better.
- **Change request filed, not a contract edit:** `docs/change-requests/P4-proxyvariant-frame-count.md`.
  `ProxyVariant`/`createProxyPlayer` carry no frame count. Video variants self-describe
  via the MP4 sample table (no gap in practice); a bare AVIF sequence does not. Worked
  around locally with an O(log n) `HEAD`-request binary search (~7-8 requests for 72
  frames) rather than touching the frozen manifest schema.
- Milestones A and B are one implementation, not two kept in sync by hand — "whole
  file" is the degenerate case of "streaming" where everything has already arrived.
- `<video>` fallback seek targets come from exact per-frame `cts`/timescale (a
  moov-only demux read, independent of WebCodecs support) rather than the brief's
  `(i + 0.5) / fps` — there is no `fps` available to this function either ( it's on
  `Manifest.proxy`, not `ProxyVariant`), and the exact timing is strictly more correct
  for a non-constant-framerate source. Same half-interval landing margin, computed
  instead of assumed.

## New dependencies

- **`mp4box` (runtime, the only one, as instructed).** No viable alternative for
  ISOBMFF demuxing that bridges to WebCodecs without reimplementing box parsing by
  hand; also used to read the exact `av1C`/`vpcC` sample-entry box for
  `VideoDecoderConfig.description` and to read the full sample table from `moov` alone
  for GOP-exact metadata before any frame data arrives.
- **`@playwright/test` + `playwright` (dev, as the brief itself instructs).** Chromium
  installed via `playwright install chromium`.
- No bundler was added for the browser test harness — this package's own `tsc` output
  plus an import map (`e2e/harness/index.html`) resolving the two bare-specifier
  runtime deps (`mp4box`, and `@understudy3d/manifest` → `zod`) to vendored copies was
  enough; one fewer moving part than a bundling step.

## Bugs found and fixed while building this (left in for transparency)

1. `firstFrame` was only ever primed by the WebCodecs player; the `<video>` fallback
   never called `getFrame(0)` itself, so `firstFrame` hung forever unless a consumer
   happened to request frame 0 — caught by hand-testing the fallback path in a real
   browser before trusting the Playwright suite to catch it; fixed in both this way,
   and added the same auto-prime to the AVIF player from the start.
2. AVIF per-frame URLs: resolving the `{i}` template through `resolveUrl`/`new URL()`
   *before* substituting the index percent-encodes `{`/`}` to `%7B`/`%7D`, silently
   breaking every frame fetch. Fixed by substituting first, resolving second.
3. `LruCache.set()` silently dropped (leaked) the previous value when a key was
   overwritten with a *different* value, never calling the eviction/close callback on
   it — a real resource leak path for concurrent fetches landing the same frame index.
   Fixed in the shared primitive with a dedicated test.
4. My own defensive codec-string check spelled out `hvc1` as a literal substring to
   reject it, which is exactly what this repo's own `assert-free-codecs.mjs` (D-004)
   flags as a violation regardless of intent. Replaced with a positive allowlist
   (`isAllowedCodecString`) that never writes the forbidden identifiers at all; reran
   the gate clean.

## Note on files touched outside this package

Only `.gitignore` (three additive lines for this package's own ephemeral test output —
regenerated reference PNGs and the Playwright runner's own report/results dirs) and
`pnpm-lock.yaml` (from `pnpm add mp4box`/`@playwright/test`/`playwright`). Neither
`packages/manifest`, `packages/stage`, nor `eslint.config.js`/`tsconfig.base.json` was
edited; `e2e/harness/main.js` and `e2e/server.mjs` instead declare their browser/Node
globals locally (`/* global */` comments, `import process from 'node:process'`, etc.)
so they lint clean under the existing root config without it needing a new override.

## Open questions

- `<video>` fallback's `bytesLoaded`/`bytesTotal` are an estimate (sum of per-frame
  sizes from the moov probe as the total; `video.buffered` fraction of `duration` as
  loaded) since a native media element's network layer isn't otherwise introspectable.
  Fine for a progress indicator; flagging in case P6 wants exactness here.
- Cache-hit-rate methodology above is a reasonable proxy, not a hard metric — it infers
  a hit from sub-1ms resolution time rather than a real instrumentation hook, since the
  frozen `ProxyPlayer` interface has no hit/miss counter to read.

## How to run it

```bash
pnpm install
pnpm -F @understudy3d/manifest run build   # proxy-player depends on its dist/
pnpm -F @understudy3d/proxy-player run typecheck   # clean
pnpm -F @understudy3d/proxy-player run test        # vitest (28) + playwright (22), 50/50
node scripts/assert-free-codecs.mjs fixtures       # clean
```
