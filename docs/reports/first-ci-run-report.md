# First real CI run — integration report (2026-10-29)

Written by the integrator (Fable) after pushing the repository to GitHub for the first time. Same spirit as `wave1-integration-report.md` and `wave2-integration-report.md`: every package's own tests were green locally, and the first run on a machine nobody had developed on still found seven CI-only problems and, behind the last of them, two real product bugs.

## What the Linux runner exposed (all fixed)

The runner image was `ubuntu-26.04` with ffmpeg 8.0.1 (`libsvtav1` present), two cores and no GPU. In the order the failures appeared:

1. **Node 20 pinned, pnpm 11 needs ≥ 22.13** (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`). Bumped to 24, matching local.
2. **Unscoped `pnpm exec playwright …` recurses into every workspace package** and fails on the first one without a local binary. Scoped with `--filter @cuep3d/viewer`.
3. **`pnpm run cuep3d -- build …` forwards a literal `--`** to the CLI, which is not `build`. Dropped the separator.
4. **Nothing built the packages before `demo:assets`** — every local run had a stale `dist/` already. Reproduced on a clean checkout by deleting every `dist/`, then added the build step.
5. **Chromium's sandbox is blocked on Ubuntu 23.10+ runners** (AppArmor restricts unprivileged user namespaces): puppeteer in `build-proxy` died with `No usable sandbox!`. Playwright is unaffected because it disables the sandbox by default. Fixed with Chromium's own documented `sysctl`, keeping the sandbox rather than passing `--no-sandbox`.
6. **`select-encoder.test.ts` asserted "this ffmpeg has no libsvtav1"** — true on the owner's Windows build, false on Ubuntu's. The test now asserts consistency with the real `ffmpeg -encoders` output.
7. **The license gate rejected `LGPL-3.0-or-later`** — on Linux, sharp ships libvips as its own package instead of inside the already-allowed `Apache-2.0 AND LGPL-3.0-or-later` Windows bundle. Same D-005b exception, different SPDX string.

Also from this run: the Pages site must be enabled once through the API or Settings (the default `GITHUB_TOKEN` can read but not create it); the e2e suites are serialized across packages and get retries on CI only; and the bench smoke test's "reach settled" wait is 150 s on CI (an upper bound, not a claim).

## The test that stayed red, and what it was really saying

`proxy-player`'s WebCodecs decode comparisons read ~8% against ground truth on Linux where the owner's machine read ~4% — while the `<video>`-element comparison on the same runner passed. Two decode paths on one machine disagreeing is the signature of a stream with no colour config. Measured with ffmpeg against the fixture's own source PNG: **0.57%** with the matrix ffmpeg had silently used when encoding (BT.601, limited range), 3.2% assuming BT.709, 5.7% assuming full range. `build-encode` never wrote a colour config; every decoder guessed; each platform guessed differently.

**D-012:** every AV1, VP9 and AVIF variant now carries explicit matrix (BT.709), primaries, transfer (sRGB) and range. One detail worth recording: ffmpeg 8's encoders take primaries/transfer from the _frames_, not from `-color_primaries`/`-color_trc` — verified on libaom, libvpx-vp9 and av1_nvenc, all four fields land only with the `setparams` filter. The decode comparisons now read 1.24–1.34% on Windows and Linux alike, to three decimals. The test's reference frames were also being re-rendered at test time with whichever font the machine had (Arial vs DejaVu); the exact PNGs the fixtures were encoded from are now committed.

## The "5.2% AV1 floor" was not AV1

The viewer's handoff diff did **not** move with D-012 (5.197% → 5.197%), which ruled out the bitstream for that package. A harness experiment then captured the overlay at `proxy-ready` (0.128% from ground truth — the display path was fine) and after the scrub, and swept it against every decoded frame: the overlay at handoff was **frame 8**, not frame 17, and Chromium had logged `texSubImage2D: can't texture a closed VideoFrame`.

Two bugs, both in frozen packages, both invisible to their own test suites:

- The WebCodecs player replaced an already-cached frame when a GOP re-walk decoded it again, and the LRU closed the original — the instance the overlay texture was holding until the next render uploaded it. The upload became a silent no-op.
- The player's "continue with the next delta frame" shortcut ran after `flush()`, which WebCodecs forbids; it threw `DataError` on exactly the sequential requests scrubbing produces, and the viewer swallowed the rejection.

**D-013:** the overlay uploads immediately (`renderer.initTexture`), the player keeps handed-out instances and always decodes from the keyframe, and a regression test holds a frame across a re-decoding prefetch. Handoff diff: **0.151%** (codec round-trip alone: 0.283%). Scrub cache hit rate in proxy-player's own benchmark: **54% → 75%**. The handoff test is back on the original §3 goal (< 2%); D-005d's 8% budget is withdrawn.

## Lessons

- A package's green suite proves the package, not the system — this is the third time merging and running for real found what no suite could (Wave 1: the zod version; Wave 2: four demo-wiring bugs; now: colour config and frame lifetime).
- Read the real log. The first rounds were diagnosed from screenshots because the web UI hides step logs behind sign-in; `gh run view --log-failed` ends that.
- When two numbers disagree across platforms, measure the components separately before touching thresholds. Nothing here was fixed by loosening a test.
