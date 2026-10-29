# P3 change request — extend `scripts/assert-free-codecs.mjs` source-scan exclusions

Status: proposed, not applied (P3 agent protocol: work only inside `packages/build-encode`,
raise shared-tooling changes here instead of editing the root script directly).

## What

`scripts/assert-free-codecs.mjs`'s `checkSource()` greps every `.ts`/`.js`/... file under
`packages/`, `apps/`, `bench/`, `scripts/`, `.github/` for forbidden legacy-codec identifiers
(`h264`, `hevc`, `avc1`, `hvc1`, `hev1`, `libx264`, `libx265`, ...), and already excludes its own
file (`SOURCE_IGNORE_FILES = new Set(['assert-free-codecs.mjs'])`) because it is "the one file
that legitimately needs to [name them]."

`packages/build-encode` now has the same legitimate need, in two files:

- `src/codec-policy.ts` exports `FORBIDDEN_CODEC_TOKENS = ['h264', 'hevc', 'avc1', 'hvc1', 'hev1', 'mpeg4', 'vc1', 'wmv3']`
  — the exact list the P3 brief specifies for `assertFreeCodecs()`.
- `src/codec-policy.test.ts` contains the brief-required unit test that scans this package's own
  source for forbidden encoder flags (`libx264`, `h264_`, etc.), per: "Never pass `-c:v libx264`,
  `h264_*`, `hevc_*`, `libx265` under any flag. Add a unit test that scans the package source for
  those strings and fails."

Running `node scripts/assert-free-codecs.mjs <any dirs>` today reports 6 false-positive
violations, all inside these two files, because `checkSource()`'s `SOURCE_SCAN_ROOTS` includes
`packages` unconditionally (regardless of the media-dir arguments passed on the command line, so
this also fires during the real CI invocation `pnpm run assert-free-codecs -- fixtures
/tmp/understudy-out`).

Proposed fix (one line, same pattern already used for the script's own file):

```js
const SOURCE_IGNORE_FILES = new Set([
  'assert-free-codecs.mjs',
  'codec-policy.ts',
  'codec-policy.test.ts',
]);
```

## Why

Both files hold the forbidden identifiers as *data* (to detect/reject them), not as ffmpeg flags
— the exact same situation the script already carves out an exception for itself over. Matching
on bare filename (not full path) is consistent with the script's existing style and is safe here:
no other package has or should have files with these two names.

## Who is affected

Only `scripts/assert-free-codecs.mjs`'s behavior when scanning `packages/build-encode`. No other
package, and no change to `assertFreeCodecs()`'s own behavior (it still rejects any non-av1/vp9
media file it's pointed at; this is purely about the source-text grep). Safe to apply any time;
does not need to wait for a wave boundary since it only widens an exclusion list.

## Local workaround applied in this wave

None needed for P3 itself — `pnpm -F @understudy3d/build-encode run test` passes cleanly, because
the package's own test (`codec-policy.test.ts`'s "source scan" describe block) already excludes
these same two filenames when scanning *its own* package directory, so P3's own test suite is
green. Only the **root** script (or whoever wires it into CI for real, per D-011 / the Wave 3 P8
agent) needs this one-line change before `pnpm run assert-free-codecs` is run against `packages`
in anger.
