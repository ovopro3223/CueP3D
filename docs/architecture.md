# Architecture

Summary view. `docs/01-design.md` is the source of truth for every contract below — this page just orients a reader before they go there.

## Package map

```
BUILD TIME (Node CLI, orchestrated by packages/cli — "cuep3d build <model.glb> -o <dir>")

  build-geometry (P1)  --model.norm.glb-->  build-proxy (P2, renders via @cuep3d/stage)
        |                                           |
        | L0/L1/L2 .glb                             | frames/*.png
        v                                            v
      [tiers]                              build-encode (P3) --AV1/VP9/AVIF + codec gate--> [ProxyVariant[]]
        |                                                                                          |
        +-------------------------------> assembled into cuep3d.json <------------------------+
                                           (@cuep3d/manifest, frozen)

RUN TIME (browser)

  cuep3d.json --read by--> viewer (P6): state machine, QualityPolicy, scrub, handoff cross-fade
                                   |                                    |
                                   v                                    v
                     proxy-player (P4)                    progressive-loader (P5)
                     GOP-aware WebCodecs decode,           loadTier / warm (shader
                     <video>/AVIF fallbacks                compile + off-screen render)
                                   \                                    /
                                    \                                  /
                                     v                                v
                              @cuep3d/stage (frozen): camera rig, environment,
                              overlay-quad render pass — both sides draw through this
                              one shared module, which is what makes the handoff exact
```

`apps/demo` and `bench` sit outside this pipeline, consuming `viewer` and the CLI's output the way any real integrator would.

## Data flow (run time)

1. `createViewer(container, { src })` requests `cuep3d.json` and builds the canvas and WebGL context while that request is in flight; it validates the manifest (`@cuep3d/manifest`) and decodes the inline poster it carries — frame 0 of the orbit as an AVIF still (D-014).
2. `QualityPolicy.choose()` — a pure function from device/network signals to a decision — picks a proxy variant and a maximum tier (`packages/viewer/src/quality-policy.ts`); `createProxyPlayer` (`@cuep3d/proxy-player`) issues the proxy request _before_ the `Stage` (`@cuep3d/stage`) is built from `manifest.stage`, with its PMREM environment deferred.
3. The poster goes on `stage`'s screen-aligned overlay quad (TTFV); the first decoded frame of the AV1/VP9/AVIF variant replaces it (`ttProxyFrame`). Once three GOPs are decodable (TTI) the environment is built and `@cuep3d/progressive-loader` is lazily imported — neither competes with the first frame.
4. `createProgressiveLoader` fetches and parses the L0 tier (after the proxy completes on slow links, alongside it on fast ones), then `warm()`s it (shader compile + one off-screen render) before anything changes on screen.
5. Once warmed and the handoff rule's conditions hold (§6: no hard main-thread stall, not mid-fast-drag), the viewer sets the live camera to the scrubbed azimuth, swaps the model in, and cross-fades the overlay out — a single-canvas operation, because the overlay and the live scene share one `WebGLRenderer`.
6. L1 then L2 load and warm the same way, swapping in without a visible stall; `settled` fires after the last tier.

The state machine (`packages/viewer/src/state-machine.ts`) makes the legal sequence (`idle → proxy-loading → proxy-ready → warming → handoff → live → upgrading → live → settled`, plus `degraded` and `error`) the only reachable one — `transition()` throws on an illegal event rather than silently allowing one.

## The three frozen contracts (§5)

- **`cuep3d.json`** (`packages/manifest`) — bounds, stage params, the proxy variant list (each with its own codec/size/frame count), the optional inline poster (frame 0 as an AVIF `data:` URL, D-014), and the tier list. `validateManifest` is the only way anything in this repo trusts a manifest's shape.
- **`@cuep3d/stage`**'s `Stage` interface — `scene`/`camera` (real three.js objects a consumer can read), `ensureEnvironment` (for a stage created with `deferEnvironment`), `setView`/`getView`, `setModel`, `setOverlayFrame`/`setOverlayOpacity`, `render`, `dispose`. Both `build-proxy` (at build time) and `viewer` (at run time) construct a `Stage` from the _same_ `manifest.stage` params — that symmetry is what makes the handoff pixel-aligned (D-007).
- **`ProxyPlayer`** (`@cuep3d/proxy-player`) — `firstFrame`, `available`, `onAvailableChange`, `getFrame`, `prefetch`, `bytesLoaded`/`bytesTotal`, `dispose`. One shape across three decode strategies (WebCodecs, `<video>`, AVIF sequence), chosen by `selectProxyVariant`.

Amendments to these contracts after Wave 0 are recorded as decisions (`docs/00-decisions.md`), not silent edits — e.g. D-005c added `ProxyVariant.frames` once `proxy-player`'s AVIF fallback turned out to need it.

## Where the speed actually comes from

Not the video codec alone — AV1 just makes the _first paint_ cheap to decode. The actual mechanism is: (1) a stand-in that's valid to show immediately because it's a finished, hardware-decoded video frame, not a 3D scene waiting for geometry/textures/shaders; (2) `warm()` guaranteeing the real model never causes a visible stall when it finally swaps in; (3) both sides sharing one camera/renderer so the swap needs no re-composition. `BENCHMARKS.md` is the evidence this actually works, not just reads well.
