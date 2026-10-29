# P6 change request — `@cuep3d/stage`'s overlay quad should not be tonemapped

Status: proposed, not applied (P6 agent protocol: work only inside `packages/viewer`, raise
shared-contract changes here instead of editing `packages/stage` directly).

## What

`packages/stage/src/stage.ts`'s overlay quad material:

```ts
const overlayMaterial = new THREE.MeshBasicMaterial({
  map: overlayTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 1,
});
```

`THREE.MeshBasicMaterial` defaults `toneMapped: true`. `renderer.toneMapping` is a renderer-level
setting (set once in `createStage` from `params.toneMapping`) that applies to every `render()`
call on that renderer, including the overlay pass — `stage.render()`'s second pass has no code
that disables it for just that pass.

The overlay quad displays a proxy frame (a PNG, baked by `build-proxy`'s `render-page.ts` using
this same `@cuep3d/stage`, or a decoded AV1/VP9/AVIF frame) that has **already** been
through the build-time renderer's own tonemapping pass once — it is a finished, display-ready
sRGB image, not a linear HDR scene value. With `toneMapped: true`, the live viewer's renderer
applies the tonemapping curve to it a **second time** before display.

## Why

Measured directly on a fixture built with `toneMapping: 'aces'` (the project's documented
default, see `docs/01-design.md` §5.2): the proxy overlay (showing a baked ACES-tonemapped PNG,
played back through a renderer with ACES tonemapping still active) showed the same ACES curve
applied twice, versus the live model (which only goes through it once, correctly, as part of its
own real-time shading). The result is a real, visually-apparent brightness/contrast shift between
the last proxy frame and the first live frame at the exact moment of handoff — the thing D-007
and this whole project's premise most depend on looking seamless.

This repo's own `packages/viewer/scripts/make-fixture.mjs` works around it by setting its test
fixture's `stage.toneMapping` to `'none'` (the only tonemapping value under which this bug cannot
manifest, since there is no curve to double-apply) and documents why in its own comments and in
`docs/reports/P6-report.md`. Any manifest produced with a non-`'none'` tonemapping (i.e. the
actual recommended production default, `'aces'`) is affected.

## Proposed fix

Add `toneMapped: false` to the overlay material:

```ts
const overlayMaterial = new THREE.MeshBasicMaterial({
  map: overlayTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 1,
  toneMapped: false,
});
```

One line, additive, changes nothing else about the overlay's rendering (still screen-aligned,
still depth-untested, still a single-canvas compositing operation per D-007/§5.3). No change to
`Stage`'s public interface (`setOverlayFrame`/`setOverlayOpacity`/etc. are untouched).

## Who is affected

`packages/stage`'s `createStage()` output only. Every consumer of a non-`'none'`-tonemapped
manifest benefits (this is the common case — `'none'` is a degenerate option, not the
recommendation); nothing regresses for `'none'`, since the fix is a no-op when there's no curve to
double-apply. `packages/build-proxy` is unaffected (it renders the _source_ PNGs once, correctly,
and never uses the overlay path itself).

## Local workaround applied in this wave

`packages/viewer/scripts/make-fixture.mjs`'s fixture manifest uses `toneMapping: 'none'`,
specifically to keep this known, separate gap from confounding the handoff pixel-diff
measurement (see `docs/reports/P6-report.md`, "Handoff pixel-diff"). This is a test-fixture-only
workaround; it does not fix the underlying issue for real manifests using `'aces'` or `'neutral'`.
