# Decisions

Decisions are recorded here when made. Later entries override earlier ones. Each entry: what, why, what it rules out.

## D-001 — Project purpose (2026-10-29)

Open-source library + build pipeline that makes a 3D model appear on a web page within a few hundred milliseconds and hands off seamlessly to the real, progressively streamed glTF. Published on GitHub as a portfolio piece demonstrating systems/architecture thinking and as a genuinely useful tool.
Rules out: anything that only works as a demo; anything tied to the owner's client project (Atlas). This repo shares no code or assets with Atlas.

## D-002 — Working name: Understudy (2026-10-29)

Theatre metaphor: the understudy (a tiny hardware-decoded video) performs until the lead (the live 3D model) is ready, then steps aside. Rename is allowed at any time before the first public release; npm scope `@understudy3d/*`.

## D-003 — Scope v1: object-centric content (2026-10-29)

Single product / hero object / small diorama viewed with an orbit camera. The proxy is an orbit video, so the technique only fits content the user looks _at_, not content the user walks _through_.
Rules out for v1: large environments, first-person navigation, multiple independent objects with separate cameras.

## D-004 — Video codec policy: AV1 only, royalty-free fallbacks, no H.264/H.265 anywhere (2026-10-29)

Primary proxy codec is AV1 (MP4/ISOBMFF container). Fallback chain for clients that cannot decode AV1: VP9 → AVIF image sequence (AVIF is AV1 still images) → poster image → skip proxy and go straight to progressive 3D. No H.264 or H.265 encoder or decoder is used, shipped, or invoked by any script, test, or CI job. A codec gate (`assert-free-codecs`) fails the build if ffprobe reports anything other than `av1`/`vp9` on produced media.
Why: H.264/HEVC are royalty-bearing and actively litigated (see README "Codec policy"); the owner also explicitly requires AV1. The accurate legal framing lives in the README; this file only records the decision.

## D-005a — Sample models: Avocado, BoomBox, WaterBottle, not DamagedHelmet (2026-10-29)

Pinned at `KhronosGroup/glTF-Sample-Assets` commit `8f492390ddc7a2ae221a1369ef560589cf8c70fb`. Checked each candidate's `metadata.json` before picking: Avocado and BoomBox are single-attribution CC0-1.0 (Microsoft, 2017). DamagedHelmet looked like a good PBR (normal/ORM) stand-in but its `metadata.json` carries **two stacked attributions**: the 2018 glTF rebuild is CC-BY-4.0, but the 2016 earlier model it was rebuilt from is CC-BY-NC-4.0 (non-commercial) — the asset as distributed is encumbered by that NC term, not cleanly CC-BY-4.0. Swapped to **WaterBottle** (CC0-1.0, single attribution, metal/roughness normal+ORM textures — same reason DamagedHelmet was wanted) instead of writing a caveat around an NC asset.
Why: this repo's own README lectures readers about checking codec IP carefully (D-004); shipping a non-commercial-encumbered demo asset while doing that would be a double standard, however small the real-world risk.
Rules out: DamagedHelmet anywhere in this repo's samples, bench or demo.

## D-005 — Everything free (2026-10-29)

Only free, open-source tooling and free hosting: Node, pnpm, TypeScript, three.js (MIT), gltf-transform (MIT), meshoptimizer (MIT), KTX-Software/toktx (Apache-2.0), FFmpeg (LGPL/GPL build) with libaom (BSD-2 + AOM patent grant), SVT-AV1 (BSD-2-Clause-Patent) or NVENC when present, libvpx (BSD-3), mp4box.js (BSD-3), Puppeteer (Apache-2.0), Vitest, Playwright (Apache-2.0), GitHub Pages, GitHub Actions (free for public repos). Sample models: Khronos glTF-Sample-Assets with CC0 or CC-BY-4.0 licenses, attributed.
Rules out: Needle Cloud or any hosted asset processing, paid CDNs, Blender as a hard dependency (not needed; frames are rendered by the same three.js stage the viewer uses).

## D-005b — LGPL transitive native deps are fine; line endings normalized via .gitattributes (2026-10-29)

Clarifies D-005: the "LGPL for the ffmpeg binary" carve-out was never meant to single out ffmpeg specifically — it's about avoiding GPL copyleft and royalty-bearing codec patents, not about banning LGPL. A transitive LGPL-licensed native binary pulled in by an allowed package (e.g. `@gltf-transform/functions` → `ndarray-pixels` → `sharp`/libvips, `LGPL-3.0-or-later`) is fine under the same reasoning as the ffmpeg carve-out: it's invoked as a separate process/library, never statically linked into anything we ship, and LGPL permits that use without imposing terms on our own MIT code. P1's auditor flag on this is resolved — no action needed, keep the dependency as-is.
Also fixes a real Wave-0 gap P1 surfaced: this Windows checkout has `core.autocrlf=true`, so every fresh `git worktree add`/clone converts the repo's LF-stored files to CRLF on checkout, making `pnpm run format` report the whole tree as misformatted even though nothing is actually wrong. Added `.gitattributes` (`* text=auto eol=lf` + explicit `binary` for png/jpg/avif/mp4/webm/glb/ktx2/woff/woff2/ico) and renormalized; this fixes it for every future checkout, clone and worktree.
Why: so this doesn't get re-flagged or worked around differently by every subsequent agent.
Rules out: any agent treating a transitive LGPL native dependency as a blocker, or hand-rolling a per-package CRLF workaround.

## D-005c — ProxyVariant carries a `frames` count (2026-10-29)

Amends §5.2 (frozen after Wave 0, reopened here between Wave 1 and Wave 2 per the agent protocol's own escape hatch): added `frames: number` to `ProxyVariant`. Raised by P4 (proxy-player) as `docs/change-requests/P4-proxyvariant-frame-count.md`, now applied and the change-request file removed — a video variant self-describes its frame count via the MP4 sample table, but a bare AVIF image-sequence variant has no container to read it from, so without this field `proxy-player`'s AVIF fallback needed an O(log n) HEAD-request probe on every page load just to learn something P3 already knows at build time. `build-encode` now sets it on every variant it produces (same `sequence.count` for all three); `proxy-player`'s AVIF player reads it directly and the probe code is gone.
Why: the probe was a real per-visitor network/latency cost on the project's own worst-case fallback path, which cuts against D-001's actual goal (fast first paint) for exactly the users who most need the fallback to be fast (no AV1/VP9 hardware decode).
Rules out: any future AVIF/image-sequence-style proxy variant needing its own frame-count discovery; it must always be read from this field.

## D-005d — Handoff acceptance criteria split into sync-correctness vs. codec-noise (2026-10-29)

Amends §3 (the project's own stated goals). P6 (viewer) measured the original single "<2% mean abs diff between last proxy frame and first live frame" target at a stable 5.2% on its own fixture, investigated thoroughly (ruled out CRF/bitrate, content shape, saturation, explicit colour metadata — see `docs/change-requests/P6-av1-color-metadata.md`), and separately proved the handoff mechanism itself (camera sync, state machine, cross-fade) is pixel-perfect: live render vs. a ground-truth render of the same frame reads 0.000%. The 5.2% is ordinary AV1 lossy-compression noise between the encoded proxy and its source — a property of using a lossy video codec at all, not a defect this project controls, and not realistically reachable at CRF 30 (or any production-sane CRF). The original target conflated two different things under one number.
Split into two: **sync correctness** (what this project actually builds and should be held to a tight bar) at <0.5%, and **visual continuity** (proxy-vs-live, inherently includes codec noise) at <8%, informational beyond that. §3 and `packages/viewer`'s own test (`handoff-pixel-diff.spec.ts`) both updated to match; the test's title was also fixed (it still said "within 2%" after the assertion itself had already been loosened).
Also amends the main-thread-stall goal: scoped to the visible cross-fade only, not the background `warm()`/tier-load work before it. `compileAsync` falls back to synchronous shader compilation (60-100ms observed) when `KHR_parallel_shader_compile` is unavailable (common on software/CI Chromium and some mobile GPUs) — a three.js/WebGL limitation, not a bug in `progressive-loader`'s correct use of the only API available to it (see `docs/change-requests/P6-compileasync-stall.md`). The stall happens before `handoff` state fires, while the static proxy overlay is still on screen with nothing animating, so it is not visible — which is what the original goal actually cared about.
Also fixed, same investigation: `packages/stage`'s overlay quad material was tonemapped twice under any non-`'none'` tonemapping (the overlay shows an already-tonemapped PNG/decoded frame, and `MeshBasicMaterial` defaults `toneMapped: true`, so the renderer's curve applied to it again) — a real, visible brightness/contrast shift at exactly the handoff moment under the project's own recommended `'aces'` default. Fixed with `toneMapped: false` on that one material (see `docs/change-requests/P6-overlay-tonemapping.md`); P6's own fixture had worked around it with `toneMapping: 'none'` to keep the investigation above uncontaminated by this separate bug, which is why the 5.2%/0.000% numbers above are clean of it.
Why: an inaccurate acceptance number is worse than a correctly-reasoned looser one, especially for a project whose whole pitch is rigor — and a benchmark nobody could ever pass isn't a target, it's a bug in the spec.
Rules out: re-chasing <2% proxy-vs-live as if it were achievable by tuning; treat codec noise and sync correctness as separate questions from here on.

## D-005e — TTFV is viewer-internal; the demo's bundle size is a separate, tracked gap (2026-10-29)

P7b (bench) ran the real §10 benchmark sweep (3 presets × 3 models × 2 modes, real Chromium CDP throttling, real built models — `BENCHMARKS.md`) and surfaced a genuine ambiguity in §3's TTFV goal: `window.__understudyMetrics`' `ttfv` is timed from `createViewer()`'s own construction, which excludes however long the hosting page's own JS took to fetch/parse/execute first. On `3g-fast`, viewer-internal TTFV is 593–605 ms (19–21% over the 500 ms goal); wall-clock TTFV (timed from navigation start — what a real visitor's clock shows) is ~2750 ms, because `apps/demo`'s own bundle (~300 KB gzip, not code-split — `@understudy3d/viewer` is a second dynamically-imported chunk on top of the ~134 KB main one) takes most of a second to download alone on 1.6 Mbps before anything can start.
Decision: TTFV/TTI are and remain viewer-internal — a boundary around what this project's own mechanism controls, the same reasoning as any framework distinguishing its own hydration/render metrics from a host page's total bundle weight. The 500 ms goal itself is **not** relaxed to fit the measured 593–605 ms (same discipline as D-005d: report the real number, don't move the goalpost) — it stays a real, currently-missed target. Both numbers are reported in `BENCHMARKS.md` (`TTFV`/`TTI` vs `Wall TTFV`/`Wall TTI`) so neither reading is hidden.
Why: a demo app's own unoptimized bundle is a legitimate, separately-fixable integration concern (code-splitting, a smaller initial chunk), not evidence the proxy-player/handoff mechanism itself is slow — conflating the two would misattribute the gap to the wrong package and make the real number impossible to act on.
Rules out: quietly widening the 500 ms budget to make current numbers pass; treating `apps/demo`'s bundle size as acceptable-as-is. Added to `docs/roadmap.md` (P8): code-split `apps/demo` so the initial chunk needed before first paint is materially smaller, and re-measure.

## D-006 — Monorepo, one package per pipeline (2026-10-29)

pnpm workspaces. Each build step and each client module is its own package with a documented interface, so one agent can own one package without touching another's files. Shared contracts (`packages/manifest`, `packages/stage`) are frozen after Wave 0; changes go through a change-request note, not a direct edit.

## D-007 — Proxy frames are rendered by the viewer's own stage code (2026-10-29)

The build pipeline renders orbit frames in headless Chromium using the _same_ `@understudy3d/stage` package (camera rig, environment, tone mapping) the live viewer uses. This is what makes the handoff invisible: the proxy frame and the first live frame are produced by identical code at identical camera parameters.
Rules out: Blender/offline renderers for the proxy (their look would never match the live three.js render).

## D-008 — Self-contained .glb per quality tier (2026-10-29)

Tiers L0/L1/L2 are each a complete .glb (meshopt geometry + KTX2 textures). Simpler loader and swap logic; costs duplicated texture bytes across tiers. Shared texture tiers are a documented roadmap item, not v1.

## D-009 — Proxy playback: WebCodecs first, `<video>` second (2026-10-29)

Primary path demuxes MP4 with mp4box.js and decodes with `VideoDecoder` (hardware AV1 where available), caching decoded frames in an LRU keyed by frame index with GOP-aware random access (keyframe every 8 frames). Fallback uses an `HTMLVideoElement` and `currentTime` seeks. Streaming decode is a v1 requirement: the first frame must be displayable after the first keyframe arrives, not after the whole file.

## D-010 — Repo language and audience (2026-10-29)

All repository text (docs, code comments, commit messages, README) is English; the audience is international hiring teams and open-source users. Working conversation with the owner stays in Levantine Arabic.

## D-011 — Agent execution model (2026-10-29)

Pipelines are implemented by Claude Sonnet agents (Sonnet 5 for the two hardest packages: proxy-player and viewer; Sonnet 4.6 acceptable elsewhere), one agent per package, each driven by its brief in `docs/briefs/`. A reviewer agent checks each result against its brief; an auditor agent checks contracts, tests and the codec gate. Fable integrates, resolves change requests and gates each wave. No agent pushes to a remote, creates external CI runs, or handles keys.
