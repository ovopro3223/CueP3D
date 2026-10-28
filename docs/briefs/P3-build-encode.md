# P3 — build-encode (Sonnet 4.6, Wave 1)

Read first: `docs/00-decisions.md` (D-004, D-005, D-009), `docs/01-design.md` §5.2 (ProxyVariant), §7 step 3, agent protocol in `docs/02-plan.md`.

## Goal

`packages/build-encode`: turn the PNG frame sequence into the proxy variants — AV1 MP4 at each size, VP9 MP4 at 512, an AVIF sequence at 512 — verify every output with ffprobe, and return `ProxyVariant[]` for the manifest. Enforce the no-H.264/H.265 policy mechanically.

## Input

```ts
export async function encodeProxy(opts: {
  framesDir: string; // NNN.png from P2 (largest size)
  outDir: string;
  sizes: number[]; // [1024, 512]; AV1 for every size, VP9 + AVIF only for the smallest
  fps: number; // 24, nominal
  gop: number; // 8
  encoder: 'auto' | 'libaom' | 'svt-av1' | 'nvenc';
  quality?: { av1Crf?: number; vp9Crf?: number; avifCrf?: number }; // defaults 30 / 33 / 28
}): Promise<ProxyVariant[]>;
```

## Output

- `<outDir>/proxy-<size>.av1.mp4` for each size; `<outDir>/proxy-<min>.vp9.mp4`; `<outDir>/frames-<min>/NNN.avif`.
- `ProxyVariant[]` ordered: AV1 (largest → smallest), VP9, AVIF sequence; `bytes` from the filesystem; `gop` set on videos.

## Implementation notes

- Locate `ffmpeg`/`ffprobe` on PATH (allow `FFMPEG_PATH` override). On start, run `ffmpeg -hide_banner -encoders` once and pick the encoder: `auto` prefers `libsvtav1` → `av1_nvenc` (only if the machine has it; never in CI) → `libaom-av1`. Log the choice.
- AV1 (libaom): `-framerate <fps> -i NNN.png -vf scale=<s>:<s>:flags=lanczos -c:v libaom-av1 -crf <crf> -b:v 0 -cpu-used 6 -row-mt 1 -g <gop> -keyint_min <gop> -pix_fmt yuv420p -movflags +faststart`. SVT-AV1: `-c:v libsvtav1 -preset 6 -crf <crf+2> -g <gop>`. NVENC: `-c:v av1_nvenc -cq <crf> -g <gop> -preset p5`.
- VP9: `-c:v libvpx-vp9 -crf <crf> -b:v 0 -g <gop> -row-mt 1 -pix_fmt yuv420p -movflags +faststart`.
- AVIF: per frame `-c:v libaom-av1 -still-picture 1 -crf <crf> -cpu-used 6` into `.avif` (use `avifenc` when on PATH, same quality intent). Run with limited concurrency (`os.cpus().length`).
- `+faststart` is mandatory: P4 streams the file and needs `moov` before `mdat`.
- After every file: `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,nb_frames -of json`; assert codec `av1`/`vp9`, dimensions, and `nb_frames === frames` (fall back to counting packets if `nb_frames` is absent). Any mismatch throws.
- Export `assertFreeCodecs(paths: string[])` used by `scripts/assert-free-codecs.mjs`; keep the forbidden list `['h264','hevc','avc1','hvc1','hev1','mpeg4','vc1','wmv3']`.
- Never pass `-c:v libx264`, `h264_*`, `hevc_*`, `libx265` under any flag. Add a unit test that scans the package source for those strings and fails.

## Tests (Vitest, Node; ffmpeg required)

- From the 72-frame numbered fixture frames (generate with `testsrc2` + `drawtext` if `fixtures/frames` is absent): AV1 512 ≤ 600 KB, AV1 1024 ≤ 1.6 MB, VP9 512 ≤ 900 KB, AVIF sequence total ≤ 1.2 MB; keyframe interval verified with `ffprobe -show_frames -show_entries frame=key_frame` (keyframes at i % 8 === 0 exactly).
- `assertFreeCodecs` rejects a locally generated `mpeg4` test file (never committed) and accepts the fixtures.
- Returned variants validate against the `ProxyVariant` zod schema.

## Out of scope

Audio, alpha, playback code, manifest assembly (CLI does it).

## Report

`docs/reports/P3-report.md` with sizes per variant for the three samples and encode times per encoder available on the owner's machine.
