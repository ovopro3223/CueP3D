# CR: ProxyVariant / createProxyPlayer carry no frame count

Status: open. Filed by P4 (proxy-player), 2026-10-29. No shared file edited — this is a note, not a patch.

## What

`ProxyVariant` (`packages/manifest/src/schema.ts`) has no frame-count field, and
`createProxyPlayer(variant: ProxyVariant, baseUrl: string)` (§5.4) receives only one
variant — never the manifest's `proxy.frames`. Both are frozen; this document is the
"work around it locally, write a note" path §02-plan.md's agent protocol asks for.

## Why it matters

- A **video** variant is self-describing: the MP4 sample table gives the exact frame
  count (`nb_samples`), GOP, codec, and timing from `moov` alone, before any frame data
  has downloaded. `createProxyPlayer`/`createWebCodecsProxyPlayer` and the `<video>`
  fallback both derive `totalFrames` this way — no gap in practice for video.
- An **image-sequence** (AVIF) variant has no container and no index of its own. There
  is no field anywhere this package receives that says how many stills exist. The
  brief's milestone D ("`available` is the full range immediately") implicitly assumes
  the count is simply known, which isn't true against the frozen signature as written.

## Local workaround (implemented, no contract change)

`avif-sequence-player.ts` discovers the sequence length itself with an O(log n)
unbounded binary search: double the probe index via `HEAD` requests until one 404s,
then binary-search the exact boundary (~7-8 requests for a 72-frame sequence, one
request for frame 0 up front to fail fast on an empty sequence). This costs a handful
of small requests once per player, not per frame, and needs no change to
`ProxyVariant` or `createProxyPlayer`.

## If this contract is ever reopened

The clean fix is adding `frames: number` to `ProxyVariant` (every variant of the same
proxy already shares one frame count at the `Manifest.proxy` level, so this is
redundant-but-convenient per-variant data, the same shape `gop` already takes) rather
than changing `createProxyPlayer`'s arity. That would let the AVIF path skip the
discovery probe entirely and let `selectProxyVariant` validate frame counts match
across variants. Not applied here because `manifest` is frozen after Wave 0 and the
workaround above is sufficient for v1.
