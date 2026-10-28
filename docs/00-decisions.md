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
