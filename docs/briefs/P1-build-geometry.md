# P1 — build-geometry (Sonnet 4.6, Wave 1)

Read first: `docs/00-decisions.md`, `docs/01-design.md` §5.1, §5.2 (Tier), §7 step 1, and the agent protocol in `docs/02-plan.md`.

## Goal

`packages/build-geometry`: turn one input `.glb` into a normalized model and three self-contained quality tiers (`L0`, `L1`, `L2`) with meshopt-compressed geometry and KTX2 textures, plus the numbers the manifest needs.

## Inputs

- `input: string` path to a `.glb` or `.gltf` (with external resources).
- `options: { outDir: string; tiers?: TierSpec[]; textures?: 'ktx2' }` where the default `TierSpec[]` is
  `L0: { ratio: 0.08, error: 0.01, maxTexture: 256, texMode: 'etc1s' }`,
  `L1: { ratio: 0.35, error: 0.005, maxTexture: 1024, texMode: 'etc1s' }`,
  `L2: { ratio: 1.0, maxTexture: 2048, texMode: 'uastc-if-normal-or-orm-else-etc1s' }`.

## Output (exported function)

```ts
export async function buildGeometry(
  input: string,
  options: BuildGeometryOptions,
): Promise<{
  normalizedGlb: string; // <outDir>/model.norm.glb — centred, pruned, uncompressed, used by P2 for rendering
  bounds: { center: [0, 0, 0]; radius: number };
  tiers: Tier[]; // §5.2 Tier objects with url relative to outDir, bytes, triangles, maxTextureSize, extensions
}>;
```

## Implementation notes

- Use `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`: `dedup`, `prune`, `flatten` (only when no animations/skins), `center({ pivot: 'center' })` then compute the bounding sphere (use the bounding box's centre and half-diagonal as radius if an exact sphere is not available; document which), `weld`, `simplify` via `meshoptimizer` (`MeshoptSimplifier`) with the tier ratio/error, `textureCompress` / `toktx` for KTX2 (`etc1s` or `uastc`), `meshopt` encode via `MeshoptEncoder` (`EXT_meshopt_compression`, `level: 'medium'`), `reorder`.
- Textures: resize to `maxTexture` before KTX2 encoding. Detect normal/ORM textures by material slot to choose UASTC for L2.
- `toktx` must be on PATH; if missing, throw with a one-line install hint for Windows (KTX-Software GitHub release) and Linux (`.deb`). No WebP fallback in v1.
- Count triangles after simplification; record bytes from the written files.
- Never emit Draco; never emit uncompressed textures in tiers.

## Tests (Vitest, Node; requires samples fetched and toktx installed — skip with a clear message if not)

- `Avocado.glb`: three tiers written (use `WaterBottle.glb` instead if you need a normal/ORM texture case for the UASTC-selection test); `L0.bytes < 150_000`, `L1.bytes < L2.bytes`, `L0.triangles < L1.triangles < L2.triangles`; every tier declares `EXT_meshopt_compression` and `KHR_texture_basisu`; `bounds.radius > 0`; model centre after normalization within 1e-4 of origin.
- Re-reading each tier with gltf-transform succeeds and reports the expected max texture size.
- A `.gltf` with external textures produces the same result as the equivalent `.glb`.

## Out of scope

Shared texture tiers across LODs, Draco, animation retargeting, WebP, any rendering.

## Report

`docs/reports/P1-report.md` with the three tiers' bytes and triangles for all three samples.
