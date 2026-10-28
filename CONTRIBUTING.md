# Contributing

This is primarily a portfolio project, but issues and PRs are welcome.

## Setup

```bash
pnpm install
pnpm run fetch-samples
```

Prerequisites: Node 20+, pnpm, `ffmpeg`/`ffprobe` with `libaom-av1` (or SVT-AV1/NVENC), and `toktx` from [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases).

## Before sending a PR

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
node scripts/assert-free-codecs.mjs fixtures
```

## Rules that are not negotiable

- No H.264/AVC or H.265/HEVC encoder, decoder, codec string or fixture, anywhere — see `docs/codec-policy.md`. CI enforces this; it will fail your PR rather than let it slide.
- No paid services, no hosted asset processing. Free and self-hostable only.
- Keep changes inside the package you're working on. Shared contracts live in `packages/manifest` and `packages/stage` — see `docs/01-design.md` §5 before touching either, and open a note in `docs/change-requests/` if one genuinely needs to change.
