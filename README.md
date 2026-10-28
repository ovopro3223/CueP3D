# Understudy

**A 3D model on screen in a few hundred milliseconds — then a seamless handoff to the real thing.**

> Status: design complete, implementation in progress. See `docs/02-plan.md`.

Loading a glTF on the web means staring at a spinner until every byte of geometry and texture has arrived, parsed, hit the GPU and compiled its shaders. Video solved this a decade ago with adaptive streaming. Understudy brings the same idea to 3D: every model gets a tiny, hardware-decoded **AV1 orbit video** rendered by the viewer's own camera rig. It shows up after the first keyframe, you can already drag to rotate it, and while you do, the real model streams in as a quality ladder (L0 → L1 → L2). When the first tier is loaded, shader-compiled and rendered once off-screen, the viewer sets the live camera to the exact angle you scrubbed to and cross-fades. Nothing jumps.

```
page load ─► first AV1 keyframe (~30 KB) ─► visible + draggable ─► L0 glTF warm ─► cross-fade ─► live 3D ─► L1 ─► L2
             ~150–500 ms on 3G                                      no stall, same camera, same lighting
```

## Why this exists

- **Time-to-first-visual**, not file size, is what makes 3D on the web feel slow. Compression (Draco, meshopt, KTX2) is a solved problem; the blank wait is not.
- The stand-in is rendered by the **same code** that renders the live model (`@understudy3d/stage`), so the handoff is pixel-aligned by construction rather than by luck.
- Everything is **free and self-hosted**: a Node CLI produces the tiers, frames and videos; a web component plays them. No cloud processing, no paid CDN.

## Codec policy — why AV1, and why there is no H.264 anywhere in this repository

Understudy encodes its stand-in videos with **AV1** and ships **no H.264 (AVC) or H.265 (HEVC) encoder, decoder, flag, fixture or test file**. A build step (`scripts/assert-free-codecs.mjs`) probes every produced media file and fails the build if it is anything other than AV1 or VP9.

The reasons, stated carefully:

- **H.264 and H.265 are royalty-bearing.** Their essential patents are licensed through patent pools (for AVC, Via Licensing Alliance, which absorbed the former MPEG LA pool) and through direct agreements with individual patent holders. Shipping products that decode or encode them is a licensing event.
- **Those patents are actively enforced in court.** Nokia, one of the largest holders of video-coding patents, sued Amazon in 2023 over H.264/H.265 use in its streaming services and devices (settled with a patent agreement in March 2025), and in 2025 sued Acer, ASUS and Hisense; a Munich court granted Nokia an injunction that temporarily stopped Acer and ASUS PC sales in Germany, Hisense settled with royalty payments, and the English courts are determining RAND terms for the rest. These are licensing disputes and injunctions, not fines, but for a small open-source project the practical lesson is the same: do not build on codecs whose use is a licensing event.
- **AV1 was designed to be royalty-free.** It is developed by the Alliance for Open Media (Google, Apple, Amazon, Netflix, Microsoft, Meta, NVIDIA, Intel, Samsung and others), whose members grant a royalty-free patent license to all implementers and fund a patent-defense program. It is the codec the open web has converged on: YouTube, Netflix, Chrome, Firefox, Edge, Safari 17+ (where hardware decode exists), Android 14, and iPhone 15 Pro and later.
- **Honesty clause.** No codec is litigation-proof. Third-party pools (Sisvel; Access Advance's video-distribution pool) assert that some of their members' patents read on AV1 and license device makers and distributors. We do not claim AV1 is free of all patent risk; we claim it is the codec with a royalty-free grant from its own developers and no pool you must pay to encode, decode or ship software — which H.264 and H.265 cannot say. `docs/codec-policy.md` carries the dated references.
- **Fallbacks stay royalty-free.** Browsers that cannot decode AV1 (notably Safari on Macs before M3 and iPhones before 15 Pro) get **VP9** (royalty-free, from Google) and then an **AVIF** frame sequence (AVIF is AV1 still images). If none of those work, the viewer skips the stand-in and goes straight to progressive 3D. H.264 is never the fallback.

## Quick start

Prerequisites (all free): Node 20+, pnpm, `ffmpeg`/`ffprobe` built with `libaom-av1` (SVT-AV1 or NVENC are used automatically when present), and `toktx` from [KTX-Software](https://github.com/KhronosGroup/KTX-Software) for KTX2 textures.

```bash
pnpm install
pnpm understudy build path/to/model.glb -o public/models/model
```

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@understudy3d/viewer/dist/understudy-viewer.js"
></script>
<understudy-viewer
  src="/models/model/understudy.json"
  style="width:100%;aspect-ratio:1"
></understudy-viewer>
```

The build writes `understudy.json` (manifest), `model.L0.glb`/`L1`/`L2` (meshopt + KTX2), `proxy-1024.av1.mp4`, `proxy-512.av1.mp4`, `proxy-512.vp9.mp4`, and `frames-512/*.avif`.

## How it works

See `docs/01-design.md` for the full design. In short: a manifest describes the bounds, the exact camera/lighting parameters, the proxy variants and the tier ladder. At run time a quality policy picks a proxy variant and a maximum tier from the device and network; the proxy player demuxes the MP4 with mp4box.js and decodes with WebCodecs (GOP-aware random access, LRU frame cache); the progressive loader loads tiers and _warms_ them (shader compile + off-screen render) before anything is shown; the stage draws proxy frames as a screen-aligned quad in the same WebGL scene so the cross-fade is a single-canvas operation.

## Prior art

Progressive LOD streaming for three.js exists in [`@needle-tools/gltf-progressive`](https://www.npmjs.com/package/@needle-tools/gltf-progressive) (LODs produced by Needle's hosted service); `<model-viewer>` offers a static `poster`; Cesium 3D Tiles streams massive environments; QuickTime VR object movies and e-commerce 360° spins scrub pre-rendered frames; Unreal Pixel Streaming renders interactive video on a server GPU. Understudy's contribution is the combination: a scrubbable, hardware-decoded stand-in produced by the viewer's own renderer, a manifest-driven quality ladder built with free local tools, and a camera-synchronized, stall-free handoff — as one self-hostable pipeline.

## Limitations (v1)

Object-centric content only (orbit camera). Single elevation ring. No transparent-background video. No animation playback inside the stand-in. See `docs/roadmap.md`.

## License

MIT. Sample models from [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets); attributions in `samples/LICENSES.md`.
