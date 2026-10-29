# Wave 1 integration report

Status: done. 2026-10-29. Integrator: Fable (this session).

## What landed

All five Wave 1 packages, built in parallel by independent Sonnet agents in separate git worktrees (one per package, each on its own branch cut from `b4d96a2`), merged into `master`:

| Package                   | Branch                  | Tests                                             |
| ------------------------- | ----------------------- | ------------------------------------------------- |
| `build-geometry` (P1)     | `p1-build-geometry`     | 12 passed, 9 skipped (no `toktx` on this machine) |
| `build-proxy` (P2)        | `p2-build-proxy`        | 6 passed                                          |
| `build-encode` (P3)       | `p3-build-encode`       | 29 passed                                         |
| `proxy-player` (P4)       | `p4-proxy-player`       | 28 unit + 22 e2e = 50 passed                      |
| `progressive-loader` (P5) | `p5-progressive-loader` | 3 unit + 3 browser = 6 passed                     |

Every package's claims were independently re-verified in this session (not just read from its own report): `pnpm install` + `typecheck` + `test` re-run from a clean worktree for each, before merging. P2's and P4's visual/numeric claims (contact-sheet render, TTFV, cache hit rate) were spot-checked directly.

## Integration fixes (found only by merging — none visible in a single-package worktree)

1. **`core.autocrlf` / Prettier false positives** (D-005b): every fresh worktree reported the whole tree as misformatted. Added `.gitattributes`, renormalized.
2. **LGPL transitive dependency** (D-005b): `@gltf-transform/functions` → `sharp`/libvips, `LGPL-3.0-or-later`. Resolved as acceptable, same reasoning as the existing ffmpeg carve-out.
3. **Codec-gate self-exclusion too narrow**: `packages/build-encode/src/codec-policy.ts` (and its test) legitimately name the forbidden codec identifiers as data; the root `assert-free-codecs.mjs` was flagging them. Widened `SOURCE_IGNORE_FILES`.
4. **Real bug: wrong dependency version picked up after merge.** `packages/proxy-player/e2e/server.mjs` resolved `zod`/`mp4box` by scanning `node_modules/.pnpm` for the first directory starting with `"<name>@"`. With one `zod` version in the store (P4's isolated worktree) this was harmless; merging Wave 1 pulled in a second, older `zod` from a sibling package's dependency tree, and the scan started picking the wrong one — **all 22 of P4's e2e tests failed** (`Cannot read properties of undefined (reading 'createPlayer')`) until fixed. This is exactly the class of bug Wave 1's isolated-worktree testing structurally cannot catch; it's why this integration step re-ran everything rather than trusting each worktree's green result.
5. **`ProxyVariant` contract amendment** (D-005c, P4's change request): added `frames: number`. Without it, the AVIF fallback player needed an O(log n) HEAD-request discovery probe on every page load — a real latency cost on the project's own worst-case path (visitors with no AV1/VP9 hardware decode). `build-encode` now sets it; `proxy-player`'s probe code is deleted.

## Verified clean, whole repo, after all of the above

```
pnpm run lint        # clean
pnpm run format      # clean
pnpm run typecheck   # clean, 8 packages
pnpm run test        # 85/85 (cli 9, manifest 8, stage 9, build-geometry 12+9skip,
                      #        build-proxy 6, build-encode 29, proxy-player 28+22e2e)
+ progressive-loader's separate test:browser: 3/3
node scripts/assert-free-codecs.mjs fixtures   # clean, 74 media + 86 source files
```

Worktrees removed (branches kept on `master` history via merge commits); `CueP3D-worktrees/` directory deleted.

## What's next (Wave 2, per docs/02-plan.md)

- **P6 — viewer** (Sonnet 5): depends on `proxy-player` and `progressive-loader`'s now-merged, real APIs. The state machine, `QualityPolicy`, and handoff are the last genuinely hard piece.
- **P0b — wire the CLI**: `cuep3d build` currently throws `NotImplementedError`; needs P1→P2→P3 orchestration.
- **P7a — demo app skeleton** can start in parallel with P6.
