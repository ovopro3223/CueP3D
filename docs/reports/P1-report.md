# P1 report — build-geometry

Status: done, with real KTX2 encoding unverified locally (no `toktx` on this machine). 2026-10-29.

## What was built

`packages/build-geometry` exports `buildGeometry(input, { outDir, tiers?, textures? })`, turning one `.glb`/`.gltf` into:

- `model.norm.glb` — centred (`center({pivot:'center'})`), deduped/pruned, flattened (skipped if the model has animations or skins), welded, **uncompressed** — for P2's renderer.
- `model.L0.glb` / `model.L1.glb` / `model.L2.glb` — each a self-contained `.glb` with `simplify()` (meshoptimizer, skipped for L2 since `ratio=1.0`), KTX2 textures (`KHR_texture_basisu`, required), and `EXT_meshopt_compression` geometry (required; via gltf-transform's `meshopt()`, which itself wraps `reorder()` + `quantize()`).
- `bounds.center`/`bounds.radius`: AABB centre and half-diagonal length (documented in `geometry.ts` — gltf-transform has no exact bounding-sphere routine, so this is the brief's stated fallback, not a minimal enclosing sphere).
- Per-tier `Tier` objects (bytes from the written file, triangles counted post-simplify, `maxTextureSize` = the tier's configured cap, `extensions` read back from the written document's actual `listExtensionsUsed()`).

Texture mode selection (`textures.ts`): `listTextureSlots(texture)` detects `normalTexture`/`occlusionTexture`/`metallicRoughnessTexture` slots → UASTC + `--assign_oetf linear`; everything else (base colour, emissive) → ETC1S + `--assign_oetf srgb`. Resize uses gltf-transform's `fitWithin` (never upscales) rounded down to a multiple of 4 (block-compression requirement), passed to `toktx --resize WxH`.

`toktx.ts` shells out to `toktx` (`--t2 --genmipmap --encode <etc1s|uastc> --assign_oetf <linear|srgb> [--resize WxH] out.ktx2 in.<png|jpg>`), via temp files cleaned up in a `finally`. `ensureToktx()` probes `toktx --version` and throws a one-line install hint **only on `ENOENT`** (binary genuinely missing); any other failure of that probe is ignored, since it isn't this function's concern.

## How to run it

```bash
pnpm install
pnpm run fetch-samples                         # Avocado/BoomBox/WaterBottle.glb
pnpm -F @understudy3d/build-geometry build
pnpm -F @understudy3d/build-geometry typecheck # clean
pnpm -F @understudy3d/build-geometry test      # 12 passed, 9 skipped (toktx not installed)
pnpm run lint                                  # clean
pnpm run format                                # clean for this package (see "repo-wide" note below)
```

```ts
import { buildGeometry } from '@understudy3d/build-geometry';
const result = await buildGeometry('samples/Avocado.glb', { outDir: 'out/avocado' });
```

## Measured numbers

**Verified locally** (no `toktx` needed — normalize/bounds/simplify/meshopt/triangle-counting run for real against all three samples):

| Model       | Textures | Raw triangles | Bounds radius (m) | L0 triangles | L1 triangles | L2 triangles |
| ----------- | -------- | ------------- | ----------------- | ------------ | ------------ | ------------ |
| Avocado     | 3        | 682           | 0.04040           | 212          | 365          | 682          |
| WaterBottle | 4        | 4510          | 0.15128           | 359          | 1577         | 4510         |
| BoomBox     | 4        | 6036          | 0.01719           | 650          | 2112         | 6036         |

All three: bounds centre `[0, 0, 0]` exactly after `center()`; triangles strictly increase L0 < L1 < L2; normalized `.glb` (uncompressed) is 8.1–10.6 MB (textures dominate, unchanged from source — this file is intentionally uncompressed).

Avocado's L0 (`ratio=0.08, error=0.01`) only reaches 212/682 = 31% of triangles, not 8%: `simplify()` stops early once the 1%-of-radius error bound binds before the ratio target does. This is meshoptimizer's documented behaviour (whichever constraint is reached first), not a bug — flagging it since it's a visible gap from the brief's target ratio.

**Not verified** (requires `toktx`, not installed on this machine — confirmed in P0's report before Wave 0 started): final tier byte sizes, the `L0.bytes < 150_000` budget, actual ETC1S/UASTC KTX2 output, and the three `describe.skipIf` suites in `build-geometry.test.ts` covering them (full Avocado tier assertions, WaterBottle UASTC-vs-ETC1S selection via `ktx-parse`'s `dataFormatDescriptor.colorModel`, and the `.gltf`-with-external-resources equivalence test). `ensureToktx()`'s missing-binary path **is** verified — it throws the expected install-hint message in this environment, and a dedicated test asserts that. All 9 skipped tests report a clear reason in their suite name (confirmed via the JSON reporter), not a silent skip.

## Deviations from the brief

- **`reorder` not called separately.** gltf-transform's `meshopt()` transform already wraps `reorder()` + `quantize()` + the `EXT_meshopt_compression` extension setup internally (confirmed by reading its source). Calling `reorder()` again ourselves would be redundant, so `build-geometry.ts` only calls `meshopt()`.
- **No `sharp` dependency added**, even though `@gltf-transform/functions`'s own `textureCompress()` wants one for resizing. Resize goes through `toktx --resize` directly instead (see textures.ts), so there's one fewer explicit dependency — see the open question below about the transitive copy that arrives anyway.
- **L2 never calls `simplify()`** when `ratio === 1`, to guarantee "full geometry" means byte-identical-to-normalized geometry, not a near-1.0 pass through the simplifier.
- Document logger is set to `Logger.Verbosity.WARN` (not the gltf-transform default `INFO`) on both the source and each cloned tier document, to stop routine `prune:`/`dedup:` info-level logging from spamming CLI output. Not asked for in the brief; a small usability call.

## Open questions / for the auditor

- **`sharp` transitive dependency.** `@gltf-transform/functions@4.5.1` hard-depends on `ndarray-pixels`, which hard-depends on `sharp` (for its own `textureCompress()`, which this package never calls). `pnpm licenses list` reports `@img/sharp-win32-x64` as `Apache-2.0 AND LGPL-3.0-or-later`. `docs/02-plan.md`'s auditor checklist pre-approves LGPL only "for the ffmpeg binary"; this is a second, unused LGPL-touched native binary (~19 MB) that arrives purely because the brief asks for `@gltf-transform/functions`. I did not attempt to override/strip it (risk of breaking gltf-transform's internals outweighs a dependency that is never imported or executed by our code) — flagging for a policy call instead.
- **toktx flags are my best-documented reading, not a verified-working invocation.** I cross-checked `--t2`, `--encode etc1s|uastc`, `--genmipmap`, `--resize WxH`, `--assign_oetf linear|srgb` against the official KTX-Software docs/forum references (not against a running binary). First real run against `toktx` (e.g. once CI's KTX-Software 4.4.2 install is exercised, or on a machine that has it) should be checked for flag-name drift between KTX-Software versions.
- Triangle counts sum one count per `Mesh` definition, not per scene-graph instance (a mesh referenced by two nodes counts once). Reasonable for "model complexity" reporting, but worth confirming that's what the manifest/CLI wants to show downstream.

## Tests

`pnpm -F @understudy3d/build-geometry test`: **12 passed, 9 skipped**, 0 failed.

- `geometry.test.ts` (6): `computeBounds`/`countTriangles` against synthetic documents — no samples, no toktx.
- `textures.test.ts` (5): `isNonColorTexture`/`roundDownToMultipleOf4` pure-logic cases.
- `build-geometry.test.ts` (1 run + 9 skipped): `ensureToktx` message-format check (runs; this environment is missing toktx, so it exercises the real throw path). The three `describe.skipIf(!toktxAvailable)` suites (Avocado tiers, WaterBottle texture-mode selection, `.gltf` equivalence) are skipped with the reason in the suite name.

Full workspace (`pnpm run build && pnpm -r test`): manifest 8/8, cli 9/9, stage 9/9, build-geometry 12/12+9 skipped — no regressions. `pnpm run lint` and the codec gate (`node scripts/assert-free-codecs.mjs fixtures`) are clean; no H.264/H.265/HEVC identifier anywhere in this package (checked by grep in addition to the gate).

Repo-wide `pnpm run format` reports every file in the repo (including untouched Wave-0 files) as misformatted — this is `core.autocrlf=true` on this Windows checkout producing CRLF line endings against Prettier's LF default, not a real formatting problem. Confirmed by re-running `prettier --end-of-line lf --check` scoped to this package's files: clean.
