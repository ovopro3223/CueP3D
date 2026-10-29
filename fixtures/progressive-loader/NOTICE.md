# `source-texture.ktx2` provenance

`source-texture.ktx2` is `examples/textures/compressed/2d_etc1s.ktx2` from the
[mrdoob/three.js](https://github.com/mrdoob/three.js) repository at tag `r171`
(pinned to the `three` version this package depends on), fetched unmodified
from
`https://raw.githubusercontent.com/mrdoob/three.js/r171/examples/textures/compressed/2d_etc1s.ktx2`.
It is a genuine Basis-Universal ETC1S-supercompressed KTX2 texture that
three.js's own test suite uses to exercise `KTX2Loader` — exactly the decode
path this package's fixture needs to cover.

Why this file and not a generated one: producing a real KTX2 texture requires
the Basis Universal / `toktx` encoder, which has no pure-JS or WASM build we
could add as an ordinary npm dependency (unlike `meshoptimizer`, which ships
WASM and needed no native tool). Installing `KTX-Software` system-wide, or
running a third-party-repackaged native `basisu` binary from npm, were both
judged disproportionate for generating one test fixture, so this package
reuses a tiny (6,629 byte), already-correct KTX2 file from a dependency this
repo already trusts and ships (`three`, MIT license) instead.

License: three.js is MIT-licensed (see its `LICENSE`); this file is used here
only as an internal Vitest/Playwright test fixture for
`@understudy3d/progressive-loader`, not redistributed as part of the published
package or any demo/sample asset.

Used by `scripts/make-progressive-loader-fixture.mjs` to build
`fixtures/progressive-loader-cube.glb`.
