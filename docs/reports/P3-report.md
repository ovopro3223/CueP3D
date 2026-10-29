# P3 report — build-encode

Status: done. 2026-10-29.

## What was built

`packages/build-encode` (`@understudy3d/build-encode`): turns a P2 "NNN.png" frame sequence into
the manifest's `ProxyVariant[]` — AV1 at every requested size (largest → smallest), VP9 and an
AVIF still-sequence at the smallest size only — ffprobe-verifying every file's codec, dimensions
and exact frame count before returning.

- `encodeProxy(opts)` — the brief's documented entry point. `src/encode-proxy.ts` orchestrates;
  `src/encode-video.ts` builds the exact ffmpeg invocations per encoder from the brief;
  `src/encode-avif.ts` runs the per-frame AVIF stills with an `os.cpus().length`-bounded worker
  pool; `src/probe.ts` does all ffprobe verification (codec/dims/frame-count, with a
  packet-counting fallback when `nb_frames` is absent, plus a keyframe-index helper tests use).
- `src/select-encoder.ts` — `selectAv1Encoder('auto'|'libaom'|'svt-av1'|'nvenc', smokeSize)`.
  `'auto'` tries svt-av1 → nvenc → libaom in order, skipping any encoder missing from `ffmpeg
  -encoders` *and* any that fails a real smoke-test encode at the requested size (not just a name
  check — `av1_nvenc` is compiled into this ffmpeg build regardless of whether the host has an
  NVIDIA GPU, and it separately rejects frame sizes below ~192px). An explicit non-auto
  preference that isn't available throws rather than silently substituting another encoder.
- `src/codec-policy.ts` — `assertFreeCodecs(paths)` and the exported
  `FORBIDDEN_CODEC_TOKENS = ['h264','hevc','avc1','hvc1','hev1','mpeg4','vc1','wmv3']`, per the
  brief. ffprobes each path and rejects anything outside `{av1, vp9}`, naming the specific
  forbidden token when one matches.
- `src/frames.ts` — reads and validates the "NNN.png" input directory (contiguous from 0,
  consistent zero-padding), independent of P2's fixed 3-digit convention.
- `src/test-support/fixture-frames.ts` — generates a 72-frame numbered-pattern source with
  `testsrc2` + `drawtext` (same approach as `scripts/make-fixtures.mjs`), used because
  `fixtures/frames` (raw PNGs) is absent in this repo — only the sibling package's already-encoded
  `fixtures/proxy-fixture.*` exist, which are outputs, not valid `encodeProxy` input.

**Tests: 29/29 passing** across 4 files (`frames.test.ts` 8, `select-encoder.test.ts` 8,
`codec-policy.test.ts` 4, `encode-proxy.test.ts` 9). `pnpm -F @understudy3d/build-encode run
test`, `run typecheck`, and repo-wide `pnpm run lint` are all clean.

**Codec gate (D-004):** `assertFreeCodecs` is exercised against the repo's committed AV1/VP9/AVIF
fixtures (accepts) and a locally-generated, never-committed `mpeg4` file (rejects, naming
`"mpeg4"`). The brief's required source-scan test (`codec-policy.test.ts`, "source scan: no
legacy codec identifiers in this package") greps this package's own source for
`libx264|libx265|h264_|hevc_|h264|hevc|avc1|hvc1|hev1` and passes — **0 violations** — excluding
only `codec-policy.ts` and `codec-policy.test.ts` themselves, which legitimately name those
tokens as data (same reasoning `scripts/assert-free-codecs.mjs` already applies to itself). See
the change request below: the **root** script does not yet know about those same two filenames,
so it reports 6 false positives there until that one-line exclusion lands.

## Measured numbers (synthetic 72-frame fixture, 1024×1024, 24fps, gop 8)

No real sample renders were available to this agent — `packages/build-geometry`,
`build-proxy`, and `samples/*.glb` don't exist in this worktree (sibling Wave-1 agents own them in
their own worktrees). Per the brief's own fallback, these numbers are from the generated
`testsrc2`+`drawtext` fixture, not Avocado/BoomBox/WaterBottle. Re-measuring against real P2
output is an open question below.

| Variant         | libaom (crf 30/33/28) | nvenc (cq 30, VP9/AVIF unaffected) | Budget   |
| --------------- | ---------------------- | ----------------------------------- | -------- |
| AV1 1024        | 751.5 KB               | 1411.2 KB                           | ≤1.6 MB  |
| AV1 512         | 169.4 KB               | 332.1 KB                            | ≤600 KB  |
| VP9 512         | 248.1 KB               | 248.1 KB                            | ≤900 KB  |
| AVIF seq (72×512) | 803.7 KB             | 803.7 KB                            | ≤1.2 MB  |

Encode time, full pipeline (AV1×2 sizes + VP9 + 72 AVIF stills, concurrency = 24 cores):

| Encoder   | Available on this machine | Time      |
| --------- | -------------------------- | --------- |
| libaom    | yes                         | ~15.0 s   |
| nvenc     | yes (NVIDIA GPU present)    | ~7.3 s    |
| svt-av1   | **no** (`libsvtav1` not compiled into this ffmpeg build) | fails in 38 ms with a clear "unavailable" error, not a crash |
| auto      | → resolves to nvenc here    | ~7.3 s    |

All four size budgets are met by both working encoders, but with real margin only for libaom;
nvenc's AV1 at `cq 30` runs ~1.9× larger than libaom's at `crf 30` for the same nominal quality
number (`cq`/`crf` aren't comparable scales across encoders) — flagged as an open question below,
not fixed here since the brief pins the exact flags to use per encoder.

## Deviations from the brief

- Smoke-tests the AV1 encoder with a real tiny encode (`-f lavfi testsrc2 ... -f null -`), not
  just a name check against `ffmpeg -encoders`, because `av1_nvenc` is compiled into this build
  regardless of GPU presence and separately rejects small frame sizes — a listed-but-unusable
  encoder would otherwise be silently selected and fail later on the real encode.
- `assertFreeCodecs`'s own forbidden-token list, verbatim from the brief, and the brief-required
  package-source scan test both necessarily contain the legacy codec identifiers as literal data.
  This trips the root `scripts/assert-free-codecs.mjs`'s own source scan (which doesn't know about
  these two filenames yet) — documented as
  `docs/change-requests/P3-codec-policy-source-scan-exclusion.md` rather than editing that root
  script directly, per the agent protocol.
- `readFrameSequence` infers zero-pad width from the first filename rather than hardcoding 3
  digits, so it isn't silently wrong if P2's convention ever changes; P2's actual output (3-digit)
  is still what's tested against.

## Open questions

- Real sizes/times against Avocado/BoomBox/WaterBottle once `build-geometry` + `build-proxy` land
  (Wave 1, different worktrees) — the numbers above are from synthetic content and will differ,
  likely favorably, since real PBR renders typically compress better than `testsrc2` noise.
- Whether nvenc's size/quality gap vs. libaom at matching nominal crf/cq values needs its own
  tuned default `cq` offset (the brief gives svt-av1 a `crf+2` offset for exactly this kind of
  cross-encoder normalization, but doesn't specify one for nvenc) — left as-is since the brief
  pins nvenc's flags exactly (`-cq <crf> -g <gop> -preset p5`) and all budgets still pass on this
  fixture.
- The root-script exclusion change request needs an owner (Wave 3 P8 agent, or whoever next
  wires `scripts/assert-free-codecs.mjs` into a real CI run against `packages`).

## How to run it

```bash
pnpm install
pnpm -F @understudy3d/build-encode run build
pnpm -F @understudy3d/build-encode run typecheck   # clean
pnpm -F @understudy3d/build-encode run test        # 29/29 passing, ~20s
pnpm run lint                                       # clean (repo-wide)
```
