# P8 — README, docs and CI (Sonnet 4.6 + Fable, Wave 3)

Read first: `docs/00-decisions.md` (D-004, D-005, D-010), `docs/01-design.md` §11, all `docs/reports/*`, agent protocol in `docs/02-plan.md`.

## Goal

Make the repository legible to a hiring team in five minutes and to a user in ten: an accurate README, a short architecture page, a codec-policy page that is legally careful, and a CI badge that is green.

## README.md (final structure — the skeleton already exists; keep its codec-policy wording unless a fact is wrong)

1. One-paragraph problem statement and a one-sentence idea.
2. `docs/media/demo.gif` (from P7), then the headline benchmark row (3g-fast, DamagedHelmet, plain vs CueP3D).
3. "How it works": the ASCII/Mermaid diagram from `01-design.md` §4, trimmed; the handoff rule in two sentences.
4. Quick start: install prerequisites (Node 20+, pnpm, ffmpeg with libaom or SVT-AV1, KTX-Software `toktx`), `pnpm cuep3d build model.glb -o out/`, drop `<cuep3d-viewer src="out/cuep3d.json">` into a page, import map/CDN note.
5. Codec policy (verbatim from the skeleton, fact-checked against the links in `docs/codec-policy.md`).
6. Browser support matrix: WebCodecs AV1 / `<video>` AV1 / VP9 / AVIF per Chrome, Edge, Firefox, Safari (macOS, iOS) with "hardware only" notes; link to the fallback chain.
7. Prior art (from §11, with links) and "what is new".
8. Limitations (v1 non-goals) and roadmap (`docs/roadmap.md`: multi-ring vertical scrub, shared texture tiers, WebGPU path, framework wrappers, AV2 when browsers ship it).
9. Development: workspace layout, `pnpm` scripts, how the agent-driven process worked (link `docs/02-plan.md` and the reports — this is part of the portfolio story).
10. Licenses: MIT for the code; sample asset attributions from `samples/LICENSES.md`.

## docs/codec-policy.md

Expand the README's section with dated references (Nokia litigation 2023–2026, Via LA's AVC pool, AOMedia patent license, Sisvel's and Access Advance's AV1 claims), each with a link, and a plain statement of what the policy does and does not claim. Tone: factual, no legal advice, no "fines".

## docs/architecture.md

Package map, data flow, the state machine, and the three contracts summarized; link to the design doc for detail.

## CI

Finalize `.github/workflows/ci.yml` from P0: cache pnpm store and Playwright browsers; run lint, typecheck, unit tests, fetch samples, build one sample, codec gate, Playwright suites, bench smoke (unthrottled), `pnpm licenses list` check; upload `BENCHMARKS.md` as an artifact. Add a `pages.yml` that builds `apps/demo` and deploys to GitHub Pages on `main` (the owner enables Pages manually).

## Acceptance

- Every claim in the README is traceable to a report, a benchmark file, or a linked source.
- `markdownlint` clean; all relative links resolve (`lychee --offline` or a small script).
- A reader can follow Quick start on a fresh Windows machine and on Ubuntu; both verified and noted in the report.

## Report

`docs/reports/P8-report.md`: list of fact-checks performed and any README statement that had to be softened.
