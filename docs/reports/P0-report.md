# P0 report — Scaffold and shared contracts

Status: done. 2026-10-29.

## What was built

- Monorepo: pnpm workspaces (`packages/*`, `apps/*`, `bench`), strict TS base config, ESLint 9 flat config (typescript-eslint + Node globals for scripts), Prettier.
- `packages/manifest`: zod schema for the full `cuep3d.json` shape (§5.2), `validateManifest` (reports every invalid field, not just the first), `resolveUrl`. 8 tests.
- `packages/stage`: `fitDistance`, `frameIndexForAzimuth`, `azimuthForFrameIndex`, `cameraPositionForView` (§5.1 math) plus `createStage` (camera rig, `studio-neutral`/`studio-warm` PMREM environments, tone mapping, overlay-quad pass for the proxy frame). 9 math tests (round-trip azimuth↔frame for 72/36 frames and a non-zero azimuth start; camera position at θ=0 → +Z and θ=π/2 → +X). `createStage` itself is not unit-tested here (needs a real WebGL context) — that lands with P2/P6's browser tests.
- `packages/cli`: `cuep3d build` argument parsing and help text per §7, with `runBuild` stubbed to throw `NotImplementedError` until Wave 2 wires P1–P3 together. 9 tests.
- `scripts/fetch-samples.mjs`: downloads Avocado, BoomBox, WaterBottle from `KhronosGroup/glTF-Sample-Assets@8f492390ddc7a2ae221a1369ef560589cf8c70fb` and writes `samples/LICENSES.md` from each model's own `metadata.json`. Verified live — all three download and the license file generates correctly.
- `scripts/assert-free-codecs.mjs`: ffprobes media files for `av1`/`vp9` and greps source for forbidden codec identifiers (excluding itself, since naming them is its job). Verified clean against the fixtures.
- `scripts/make-fixtures.mjs`: generates the committed P4 fixtures from a single numbered-pattern source — `fixtures/proxy-fixture.av1.mp4`, `fixtures/proxy-fixture.vp9.mp4`, `fixtures/avif/000..071.avif` (72 frames, 256×256, GOP 8, 0-indexed). Verified: ffprobe reports `codec_name=av1`/`vp9`, `width=height=256`, `nb_frames=72`; keyframes land exactly at i % 8 == 0.
- `.github/workflows/ci.yml`: installs ffmpeg + toktx (KTX-Software v4.4.2), lint/format/typecheck/test, fetches samples, builds one sample (will fail until Wave 2 — expected for now), runs the codec gate.
- `docs/briefs/`, `reports/`, `reviews/`, `audits/`, `change-requests/` scaffolded. `CONTRIBUTING.md` added.

## Deviations from the brief

- **D-005a (new decision):** swapped the planned `DamagedHelmet` sample for `WaterBottle`. Checking `DamagedHelmet/metadata.json` before downloading showed it carries two stacked attributions — a 2018 CC-BY-4.0 rebuild of a 2016 **CC-BY-NC-4.0** (non-commercial) model. `WaterBottle` is single-attribution CC0-1.0 with the same normal/ORM PBR textures P1 wanted to exercise. Updated everywhere `DamagedHelmet` was mentioned (`01-design.md` §10, P1/P7 briefs).
- `createStage`'s unit tests are math-only per the brief; the function itself needs a real `WebGLRenderer`, which P0's Node/Vitest setup doesn't provide. This matches the brief's own scope ("Tests ... math only"), noted here so it isn't mistaken for a gap later.
- Added `globals` as a devDependency (not in the original tool list) — needed for ESLint to recognize Node globals (`process`, `console`, `fetch`) in the plain `.mjs` scripts; TypeScript files didn't need it since `@types/node` already covers them.
- Added `@types/three` (0.186.x) since three.js 0.171 does not ship its own type declarations in a way `tsc` could resolve for the `examples/jsm` subpath; typecheck is clean against it.
- Root `typecheck`/`test` scripts now run `pnpm run build` first, so a dependent package (`stage` → `manifest`) can resolve the dependency's compiled `.d.ts`/`.js`. Not in the original brief but necessary given `exports` pointing only at `dist/`.

## How to run it

```bash
pnpm install
pnpm run lint          # clean
pnpm run format        # clean
pnpm run typecheck     # clean (builds deps first)
pnpm run test          # 26/26 passing
node scripts/fetch-samples.mjs
node scripts/assert-free-codecs.mjs fixtures
node packages/cli/dist/bin.js build --help
```

## Open questions for Wave 1

- P2's brief assumes Puppeteer-launched Chromium; not installed or verified in this wave (P0 didn't need it). First P2 agent should budget time for `pnpm add puppeteer` and a SwiftShader sanity check.
- `toktx` is not installed on the owner's Windows machine yet (confirmed before Wave 0 started) — P1's agent will hit this immediately; the Windows installer is `KTX-Software-4.4.2-Windows-x64.exe` from the same GitHub release used in CI.
