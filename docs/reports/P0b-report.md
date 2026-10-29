# P0b report — wire the CLI

Status: done. 2026-10-29. By: Fable (direct integration work, not a dispatched agent — this is orchestration glue over already-built packages, not new design).

## What was built

`packages/cli/src/build-command.ts`'s `runBuild` now really runs the pipeline: `buildGeometry` (P1) → `renderProxyFrames` (P2, fed P1's `model.norm.glb`) → `encodeProxy` (P3, fed P2's rendered frames) → assembles and writes a schema-validated `understudy.json`. `NotImplementedError` and its references in `bin.ts`/`index.ts` are gone; CLI errors now print `understudy build failed: <message>` and exit 1 instead of an uncaught stack trace.

Output layout: P1 and P3 write directly into `outDir` (tier `.glb`s, proxy videos/AVIF sequences — their `url` fields are basenames, resolved relative to the manifest), since that's where the manifest needs them. P2's `frames/NNN.png` + `camera.json` are build-time-only inputs to P3 and go in `<outDir>/.proxy-source/`, never referenced by the manifest.

## Also fixed along the way

- **Installed `toktx` (KTX-Software 4.4.2) on this machine**, with the owner's explicit go-ahead (asked first, per the file-download policy) — real verification of P1's KTX2 path was otherwise impossible. Added to the user's persistent PATH; this session's already-open shells needed a one-off `PATH=...:/c/Program Files/KTX-Software/bin` prefix per command (new shells pick it up automatically). As a side effect, `build-geometry`'s test suite went from 12 passed/9 skipped to **21 passed/0 skipped** — every toktx-gated assertion now actually runs.
- **CI ordering bug**: `.github/workflows/ci.yml` ran tests _before_ `fetch-samples`, so any sample-dependent test (several of `build-geometry`'s) would have failed the first time this ever ran in CI. Reordered: fetch samples first.

## Verified — a real, complete, end-to-end build

```
node packages/cli/dist/bin.js build samples/Avocado.glb -o out/avocado --frames 72
```

Ran for real: 72 orbit frames rendered (SwiftShader), encoder auto-selected `nvenc` (this machine's GPU), full tier set and proxy variant set produced, `understudy.json` written and passed `validateManifest`. Output inspected directly: `model.L0.glb` 26.7KB / `L1` 157KB / `L2` 11.2MB (triangles 212/365/682), `proxy-1024.av1.mp4` 384KB, `proxy-512.av1.mp4` 150KB, `proxy-512.vp9.mp4` 89KB, `frames-512/*.avif` totaling 320KB. `node scripts/assert-free-codecs.mjs out/avocado` clean.

**Noted, not a bug**: `model.L2.glb` (11.2MB) is larger than the original `Avocado.glb` download (8.1MB). This is expected GPU-texture-format behavior — KTX2/UASTC trades file size for zero-CPU-decode GPU readiness and isn't as space-efficient as source JPEG at the same visual quality. L2 is the last tier loaded (after L0/L1 already show something), so this doesn't affect the project's actual speed goal, but it's worth knowing if someone's first reaction to the numbers is "why did compression make it bigger."

Added `packages/cli/src/build-command.test.ts`: a real (not mocked) end-to-end Vitest integration test, `describe.skipIf`-gated on `toktx` + fetched samples being present (same pattern P1 uses), asserting the manifest validates and every tier/variant file it references actually exists on disk.

## Full suite after this change

```
pnpm run lint        # clean
pnpm run format      # clean
pnpm run typecheck   # clean, 9 packages
pnpm run test        # manifest 8, stage 9, cli 10 (+1 new), build-geometry 21 (0 skipped now),
                      # build-proxy 6, build-encode 29, proxy-player 28+22e2e, progressive-loader 3
                      # = 114 unit/integration + 22 e2e, all passing
+ progressive-loader's test:browser: 3/3
node scripts/assert-free-codecs.mjs fixtures out   # clean, 149 media + 87 source files
```

## Open items

- `BuildArgs` has no way to override per-tier simplification ratios/texture sizes (`DEFAULT_TIERS` is always used) — fine for v1, flagged for `docs/roadmap.md`.
- `fovDeg`/`exposure`/`toneMapping` are hardcoded in `runBuild` (35° / 1.0 / `'aces'`), not exposed as CLI flags — matches §7's documented flag set exactly (that set never included them), not a gap against the spec.
