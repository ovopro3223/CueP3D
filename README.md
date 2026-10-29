# CueP3D

[![CI](https://github.com/ovopro3223/CueP3D-/actions/workflows/ci.yml/badge.svg)](https://github.com/ovopro3223/CueP3D-/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-GitHub%20Pages-2ea44f)](https://ovopro3223.github.io/CueP3D-/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A 3D model on screen in a few hundred milliseconds — then a seamless handoff to the real thing.**

**[Open the live demo](https://ovopro3223.github.io/CueP3D-/)** — plain three.js loading next to CueP3D, same model, same camera; pick a model, drag either one. For the slow-network numbers below, throttle it from DevTools (the page explains how).

> Status: working end to end — build pipeline, viewer, demo and real benchmarks all real, all in this repo. Not published to npm yet; build it from source (Quick start below). See `docs/02-plan.md` for how it was built and `BENCHMARKS.md` for the numbers behind the claims below.

![CueP3D demo: a proxy frame appears almost instantly, the visitor drags to orbit it, then it hands off to the live, interactive 3D model](docs/media/demo.gif)

Loading a glTF on the web means staring at a spinner until every byte of geometry and texture has arrived, parsed, hit the GPU and compiled its shaders. Video solved this a decade ago with adaptive streaming. CueP3D brings the same idea to 3D: every model gets a tiny, hardware-decoded **AV1 orbit video** rendered by the viewer's own camera rig. It shows up almost instantly, you can already drag to rotate it, and while you do, the real model streams in as a quality ladder (L0 → L1 → L2). When the first tier is loaded, shader-compiled and rendered once off-screen, the viewer sets the live camera to the exact angle you scrubbed to and cross-fades. Nothing jumps.

```
page load ─► manifest (frame 0 inline) ─► visible ─► first AV1 keyframe ─► draggable ─► L0 glTF warm ─► cross-fade ─► live 3D ─► L1 ─► L2
             one round trip, ~3–6 KB      ~250 ms     ~420–450 ms         ~650–1100 ms  no stall, same camera, same lighting   (3g-fast)
```

**Real measured numbers** (median of 3 runs, real Chromium network throttling, real built models — full table in `BENCHMARKS.md`):

| Preset (download / RTT)     | Plain `GLTFLoader` | CueP3D first visual | CueP3D first video frame | Speedup (first visual) |
| --------------------------- | ------------------ | ------------------- | ------------------------ | ---------------------- |
| wifi (30 Mbps / 20 ms)      | 2.6–3.3 s          | 73–74 ms            | 131–134 ms               | ~35–46×                |
| 4g (9 Mbps / 60 ms)         | 7.8–10 s           | 125–132 ms          | 202–234 ms               | ~62–78×                |
| 3g-fast (1.6 Mbps / 150 ms) | 42–54 **s**        | 247–253 ms          | 419–453 ms               | **~169–216×**          |

Two things worth being upfront about, in the spirit of this project's own rigor (see `docs/00-decisions.md` D-005e and D-014 for the full reasoning): the TTFV numbers above are the viewer's own internal timing, measured from when it starts working — not from page navigation; the demo page's own JS (three.js above all) still adds about 1.6 s on 3g-fast before the viewer can start, which `BENCHMARKS.md` reports as `Wall TTFV`. And "first visual" since D-014 is the manifest's inline poster — frame 0 of the orbit at proxy resolution, from the same rendered PNG as the video, replaced by the first decoded video frame one round trip later. That video frame is reported too (`First video frame` in `BENCHMARKS.md`): 419–453 ms on 3g-fast, itself under the 500 ms goal that D-005e recorded as missed at 593–605 ms.

## Why this exists

- **Time-to-first-visual**, not file size, is what makes 3D on the web feel slow. Compression (Draco, meshopt, KTX2) is a solved problem; the blank wait is not.
- The stand-in is rendered by the **same code** that renders the live model (`@cuep3d/stage`), so the handoff is pixel-aligned by construction rather than by luck.
- Everything is **free and self-hosted**: a Node CLI produces the tiers, frames and videos; a web component plays them. No cloud processing, no paid CDN.

## Codec policy — why AV1, and why there is no H.264 anywhere in this repository

CueP3D encodes its stand-in videos with **AV1** and ships **no H.264 (AVC) or H.265 (HEVC) encoder, decoder, flag, fixture or test file**. A build step (`scripts/assert-free-codecs.mjs`) probes every produced media file and fails the build if it is anything other than AV1 or VP9.

The reasons, stated carefully:

- **H.264 and H.265 are royalty-bearing.** Their essential patents are licensed through patent pools (for AVC, Via Licensing Alliance, which absorbed the former MPEG LA pool) and through direct agreements with individual patent holders. Shipping products that decode or encode them is a licensing event.
- **Those patents are actively enforced in court.** Nokia, one of the largest holders of video-coding patents, sued Amazon in 2023 over H.264/H.265 use in its streaming services and devices (settled with a patent agreement in March 2025), and in 2025 sued Acer, ASUS and Hisense; a Munich court granted Nokia an injunction that temporarily stopped Acer and ASUS PC sales in Germany, Hisense settled with royalty payments, and the English courts are determining RAND terms for the rest. These are licensing disputes and injunctions, not fines, but for a small open-source project the practical lesson is the same: do not build on codecs whose use is a licensing event.
- **AV1 was designed to be royalty-free.** It is developed by the Alliance for Open Media (Google, Apple, Amazon, Netflix, Microsoft, Meta, NVIDIA, Intel, Samsung and others), whose members grant a royalty-free patent license to all implementers and fund a patent-defense program. It is the codec the open web has converged on: YouTube, Netflix, Chrome, Firefox, Edge, Safari 17+ (where hardware decode exists), Android 14, and iPhone 15 Pro and later.
- **Honesty clause.** No codec is litigation-proof. Third-party pools (Sisvel; Access Advance's video-distribution pool) assert that some of their members' patents read on AV1 and license device makers and distributors. We do not claim AV1 is free of all patent risk; we claim it is the codec with a royalty-free grant from its own developers and no pool you must pay to encode, decode or ship software — which H.264 and H.265 cannot say. `docs/codec-policy.md` carries the dated references.
- **Fallbacks stay royalty-free.** Browsers that cannot decode AV1 (notably Safari on Macs before M3 and iPhones before 15 Pro) get **VP9** (royalty-free, from Google) and then an **AVIF** frame sequence (AVIF is AV1 still images). If none of those work, the viewer skips the stand-in and goes straight to progressive 3D. H.264 is never the fallback.

## Quick start

Not published to npm — clone and build it. Prerequisites (all free): Node 22.13+ (pnpm 11.x requires it), pnpm, `ffmpeg`/`ffprobe` built with `libaom-av1` (SVT-AV1 or NVENC are used automatically when present), and `toktx` from [KTX-Software](https://github.com/KhronosGroup/KTX-Software) for KTX2 textures. On Ubuntu 23.10+ (or any distro that restricts unprivileged user namespaces), the build's headless-Chromium render step needs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` once per boot — [Chromium's note](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).

```bash
git clone https://github.com/ovopro3223/CueP3D- && cd CueP3D-
pnpm install
pnpm run build
pnpm cuep3d build path/to/model.glb -o public/models/model
```

`packages/viewer/dist/index.js` is a real ESM module — point a bundler (or an import map) at it from your own app:

```html
<script type="importmap">
  { "imports": { "@cuep3d/viewer": "/path/to/packages/viewer/dist/index.js" } }
</script>
<script type="module">
  import '@cuep3d/viewer'; // registers <cuep3d-viewer>, no further setup
</script>
<cuep3d-viewer src="/models/model/cuep3d.json" style="width:100%;aspect-ratio:1"></cuep3d-viewer>
```

The build writes `cuep3d.json` (manifest, with frame 0 inlined as a ~3–6 KB AVIF poster so the first visual costs no second request), `model.L0.glb`/`L1`/`L2` (meshopt + KTX2), `proxy-1024.av1.mp4`, `proxy-512.av1.mp4`, `proxy-512.vp9.mp4`, and `frames-512/*.avif`. See `apps/demo` for a complete, working example (it's the app the GIF above was recorded from): `pnpm run fetch-samples && pnpm run demo:assets && pnpm --filter @cuep3d/demo run dev`.

## How it works

See `docs/01-design.md` for the full design. In short: a manifest describes the bounds, the exact camera/lighting parameters, the proxy variants, the tier ladder, and carries frame 0 inline so the first visual arrives with the manifest itself. At run time a quality policy picks a proxy variant and a maximum tier from the device and network; the proxy player demuxes the MP4 with mp4box.js and decodes with WebCodecs (GOP-aware random access, LRU frame cache); the progressive loader — imported only once the proxy is interactive — loads tiers and _warms_ them (shader compile + off-screen render) before anything is shown; the stage draws proxy frames as a screen-aligned quad in the same WebGL scene so the cross-fade is a single-canvas operation.

## Browser support

`proxy-player`'s `selectProxyVariant` probes capability at runtime (`VideoDecoder.isConfigSupported`, then `canPlayType`, then an AVIF probe) rather than assuming anything from this table — it's here as background, not as logic the code trusts.

| Browser                           | WebCodecs AV1                                                     | `<video>` AV1 | VP9 | AVIF |
| --------------------------------- | ----------------------------------------------------------------- | ------------- | --- | ---- |
| Chrome / Edge (desktop + Android) | Yes                                                               | Yes           | Yes | Yes  |
| Firefox (desktop)                 | Yes                                                               | Yes           | Yes | Yes  |
| Safari (macOS)                    | Hardware only — M3 and later                                      | same          | Yes | Yes  |
| Safari (iOS/iPadOS)               | Hardware only — A17 Pro and later (iPhone 15 Pro+, iPhone 16/16e) | same          | Yes | Yes  |

Safari without AV1 hardware (Intel Macs, M1/M2, pre-15-Pro iPhones) and any browser with neither WebCodecs AV1 nor `<video>` AV1 fall through to VP9, then AVIF, then straight to progressive 3D with no stand-in. H.264 is never in the chain. This table is a snapshot, not load-bearing — verify against current WebKit/Chromium release notes before relying on it; see `docs/codec-policy.md`.

## Prior art

Progressive LOD streaming for three.js exists in [`@needle-tools/gltf-progressive`](https://www.npmjs.com/package/@needle-tools/gltf-progressive) (LODs produced by Needle's hosted service); `<model-viewer>` offers a static `poster`; Cesium 3D Tiles streams massive environments; QuickTime VR object movies and e-commerce 360° spins scrub pre-rendered frames; Unreal Pixel Streaming renders interactive video on a server GPU. CueP3D's contribution is the combination: a scrubbable, hardware-decoded stand-in produced by the viewer's own renderer, a manifest-driven quality ladder built with free local tools, and a camera-synchronized, stall-free handoff — as one self-hostable pipeline.

## Limitations (v1)

Object-centric content only (orbit camera). Single elevation ring. No transparent-background video. No animation playback inside the stand-in. `<cuep3d-viewer>`'s `policy`/`debug` options are JS-API-only (not element attributes). Wall-clock first visual on a slow link is still bounded by three.js's own ~134 KB gzip arriving before the viewer can start (see `Wall TTFV` in `BENCHMARKS.md`). Full list: `docs/roadmap.md`.

## Development

Built by Claude agents working in parallel git worktrees, one package per agent, against frozen contracts (`docs/01-design.md` §5) and a written plan (`docs/02-plan.md`) — each agent's report is in `docs/reports/`, and real bugs found only by merging and running the whole system live in a browser are in `docs/reports/wave1-integration-report.md`, `wave2-integration-report.md` and `first-ci-run-report.md` (the last one: what the first run on a machine nobody had developed on found, including two product bugs behind a number that had been documented as codec noise). This process — not just the code it produced — is part of what this repository demonstrates.

```bash
pnpm install
pnpm run lint && pnpm run typecheck && pnpm run test   # 299+ tests
node scripts/assert-free-codecs.mjs fixtures            # the D-004 codec gate
pnpm run bench                                           # real network-throttled numbers (~25 min)
```

Workspace layout: `packages/manifest`, `stage` (shared, frozen after Wave 0), `build-geometry`, `build-proxy`, `build-encode` (the CLI pipeline), `proxy-player`, `progressive-loader`, `viewer` (the runtime), `cli`; `apps/demo` and `bench` at the top level. See `docs/architecture.md` for the package map and data flow.

## License

MIT. Sample models from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets); attributions in `samples/LICENSES.md`.
