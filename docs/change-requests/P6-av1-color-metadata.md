# P6 finding — AV1 proxy decode has a ~4-5% floor vs. ground truth, cause not fully isolated

## Resolution (2026-10-29, D-012) — half of it was exactly the colour-metadata lead

The first real CI run (Linux, Chromium with no GPU) made the same proxy-player decode tests that
read ~4% here read ~8%, while the `<video>`-element path on the same machine passed — two decode
paths on one machine disagreeing is the signature of a stream with no colour config. Measured
directly with ffmpeg against the P4 fixture's ground-truth PNG: decoded with the matrix ffmpeg had
silently used when encoding (BT.601, limited range) the frame reads **0.57%**; decoded assuming
BT.709 it reads 3.2%; assuming full range, 5.7%. `build-encode` never wrote a colour config, so
every decoder guessed, and each platform guessed differently.

Fix: `build-encode` now converts RGB → YUV with BT.709 and stamps matrix, primaries (BT.709),
transfer (sRGB) and range (limited) into every AV1, VP9 and AVIF variant
(`packages/build-encode/src/color.ts`). Result on `proxy-player`'s canvas-path tests: **~4% → 1.24-1.34%**
on the owner's machine. The lead above ("explicit colour metadata ... made no measurable difference")
was right to be the most promising one; it did not pan out then because `-color_primaries` /
`-color_trc` are ignored by ffmpeg 8's encoders unless the frames themselves carry them (`setparams`),
and because this package's own number is dominated by something else:

The viewer's handoff diff on the regenerated fixture is **5.197%** after the fix vs 5.203% before —
unchanged. So the remaining ~5% in _this_ package is not the bitstream at all; it is in how the
decoded `VideoFrame` reaches the overlay texture (VideoFrame → WebGL upload / texture colour
handling in `@cuep3d/stage`). Tracked in `docs/roadmap.md`; `handoff-pixel-diff.spec.ts` keeps its 8%
budget with this update noted in its own comment.

---

Status: **investigation report, not a proposed fix** — unlike this repo's other change-request
notes, this one does not end in a one-line patch. Recorded here (not just in
`docs/reports/P6-report.md`) because it affects `packages/build-encode` and/or
`packages/proxy-player` output quality and is squarely Wave 1 territory to actually fix; P6's
protocol is to work inside `packages/viewer` and raise this instead of touching either package.

## What

`docs/01-design.md` §3 sets a goal: "mean absolute pixel difference between the last proxy frame
and the first live frame at the same azimuth < 2% (automated test)." Measured on this package's
own fixture (`packages/viewer/scripts/make-fixture.mjs`, a plain untextured sphere, no sharp
edges or text): **5.203%, stable across repeated runs.**

That number is **not** evidence of a handoff bug in `packages/viewer`. A second, stricter test —
`packages/viewer/e2e/tests/handoff-pixel-diff.spec.ts`'s "the live render is pixel-identical to
the exact ground-truth frame..." — compares the live render directly against `build-proxy`'s own
ground-truth PNG for the same frame index, with **no video codec involved at all**, and reads
**0.000%**. The camera sync, state machine, `OrbitControls` handoff and cross-fade this package
owns are exactly correct. The entire 5.2% sits in the gap between that ground-truth PNG and what
`@cuep3d/proxy-player` hands back after decoding the AV1 video `build-encode` made from it.

## What was ruled out (each verified directly on this fixture, not assumed)

- **CRF / bitrate.** `av1Crf: 0` (lossless) and `av1Crf: 4` (near-lossless) read identically to
  three decimal places. Production's default is `av1Crf: 30`.
- **Content shape.** A cube with a sharp-text KTX2 texture (reused from
  `fixtures/progressive-loader-cube.glb`) measured ~7.5%; a plain untextured cube (hard 90°
  face-normal edges) measured ~4.4%; the current plain sphere (no hard edges anywhere) measures
  ~4.9-5.2%. Shape/edges move the number somewhat but never close to 2%.
- **Saturation.** A saturated red material (`[0.75, 0.22, 0.18]`) vs. a desaturated neutral one
  (`[0.65, 0.6, 0.52]`) read within ~0.3% of each other.
- **Explicit colour metadata.** Encoding directly with ffmpeg (bypassing
  `encodeProxy`/`encode-video.ts`, which never passes `-color_primaries`/`-color_trc`/
  `-colorspace`/`-color_range`) and adding explicit `-color_primaries bt709 -color_trc bt709
-colorspace bt709 -color_range pc` — a real, known class of bug in web video pipelines where an
  encoder's and a decoder's default colour-matrix/range assumptions disagree — made no measurable
  difference. This was the most promising lead and did not pan out; recorded so a future
  investigation doesn't retry it from scratch.
- **The overlay-tonemapping bug** (`docs/change-requests/P6-overlay-tonemapping.md`) is a
  separate, already-identified issue and is not the cause here — this fixture uses
  `toneMapping: 'none'` specifically to keep it out of this measurement.

## What is not yet known

Given the above, the remaining gap most likely lives in one of:

1. The browser's own WebCodecs `VideoFrame` → canvas/texture upload path (Chromium-internal,
   outside every package in this repo).
2. Something specific to this development machine's AV1 decode path (software vs. hardware,
   driver version) that a different machine or a real production GPU would not reproduce.
3. Something in `proxy-player`'s own frame handling between `VideoDecoder.decode()` and the
   `VideoFrame` it hands back — frozen, not inspected in depth here per this wave's protocol.

`docs/reports/P4-report.md` independently measured "a correct decode sits around 4% mean abs diff
(AV1 compression noise against the regenerated source, not an error)" on its own, unrelated
fixture — the same rough magnitude, which is weak but real corroboration that this is a broader
property of this environment's AV1 round trip, not specific to this package's fixture.

## Who is affected

Any manifest's proxy video variant, at any resolution or CRF — this is not a tuning problem.
Affects the literal <2% acceptance number in `docs/01-design.md` §3 and `docs/02-plan.md`'s
definition of done ("Handoff pixel-diff test ... pass in CI"), on whichever machine ends up
running that CI.

## Local workaround applied in this wave

`packages/viewer/e2e/tests/handoff-pixel-diff.spec.ts` asserts `< 8%` (not `< 2%`) for the
proxy-vs-live comparison, with this file and `docs/reports/P6-report.md` linked in its own
comment, and keeps the ground-truth-vs-live test (asserting `< 0.5%`) as the real proof of
handoff correctness. 8% was chosen with headroom above the measured 5.2% (a genuine capture-timing
bug found and fixed during this investigation briefly pushed the same comparison to 8.9%) while
still catching a real regression (a wrong camera/azimuth or a stale frame read 70-80%+ during this
same investigation, before being found and fixed).
