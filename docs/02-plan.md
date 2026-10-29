# CueP3D — Implementation plan

Companion to `01-design.md`. One brief per pipeline in `docs/briefs/`. Agents: Claude Sonnet (5 for P4 and P6, 4.6 acceptable for the rest), one agent per package, per D-011.

## Waves and dependencies

```
Wave 0  P0 scaffold + contracts (Fable)            ──┐
Wave 1  P1 geometry   P2 proxy-render   P3 encode    │ all depend only on P0
        P4 proxy-player   P5 progressive-loader      │ (P3 starts on synthetic frames; P4 on a fixture mp4)
Wave 2  P6 viewer/handoff (needs P4 + P5 APIs)   P0b wire CLI (needs P1–P3)   P7a demo app skeleton
Wave 3  P7b benchmarks (needs everything)   P8 README/docs/CI final   reviewer + auditor passes
```

| Pipeline | Package                                                             | Depends on                         | Model              | Est.     |
| -------- | ------------------------------------------------------------------- | ---------------------------------- | ------------------ | -------- |
| P0       | manifest, stage, cli skeleton, repo tooling, sample assets, CI file | —                                  | Fable              | 1–2 days |
| P1       | build-geometry                                                      | P0                                 | Sonnet 4.6         | 2 days   |
| P2       | build-proxy                                                         | P0 (stage)                         | Sonnet 4.6         | 2–3 days |
| P3       | build-encode                                                        | P0 (manifest)                      | Sonnet 4.6         | 2 days   |
| P4       | proxy-player                                                        | P0 (manifest), fixture mp4 from P0 | Sonnet 5           | 4 days   |
| P5       | progressive-loader                                                  | P0 (stage, manifest)               | Sonnet 4.6         | 2–3 days |
| P6       | viewer                                                              | P4, P5, P0                         | Sonnet 5           | 4–5 days |
| P7       | apps/demo, bench                                                    | P6, wired CLI                      | Sonnet 4.6         | 3 days   |
| P8       | README, docs, .github                                               | all                                | Sonnet 4.6 + Fable | 2 days   |

Calendar (owner has > 1 month): Week 1 — Wave 0 and Wave 1 start. Week 2 — Wave 1 lands, P6 starts. Week 3 — P6 and P7a. Week 4 — P7b, P8, polish, demo GIF, first public release. Buffer: remaining days.

## Agent protocol (every brief inherits this)

1. Read `docs/00-decisions.md`, `docs/01-design.md` §5 (contracts), and your brief. Nothing else is required reading.
2. Work only inside your package directory (plus your package's tests). Shared packages `manifest` and `stage` are read-only after Wave 0. If a contract must change, write `docs/change-requests/<P>-<slug>.md` (what, why, who is affected) and continue with a local adapter; do not edit the shared package.
3. TypeScript strict, ESM, Node 20+. Tests with Vitest (Node) or Playwright (browser) as the brief states. `pnpm -F <package> test` and `pnpm -F <package> typecheck` must pass.
4. No H.264/H.265 anywhere — not in code, fixtures, test media, or tool flags. No paid or hosted services. No new runtime dependency without a one-line justification in your report.
5. Default to no code comments; a short comment only where the _why_ is non-obvious (a workaround, a hidden constraint).
6. Finish with `docs/reports/<P>-report.md`: what was built, how to run it, measured numbers, deviations from the brief, open questions. Keep it under one page.
7. Never push, never create remote CI runs, never touch keys or secrets. Commit locally on your branch `p<n>-<package>` with conventional messages.

## Review protocol

- Reviewer (Sonnet): reads the brief and the diff; checks acceptance criteria one by one; writes `docs/reviews/<P>-review.md` with PASS/FAIL per criterion.
- Auditor (Sonnet): runs the test suites, the codec gate and the dependency-license check (`pnpm licenses list`, fail on anything not MIT/BSD/Apache/ISC/0BSD/CC0/Unlicense/LGPL-for-ffmpeg-binary); checks that shared contracts were not edited; writes `docs/audits/<P>-audit.md`.
- Fable: merges when both pass, resolves change requests (updating contracts only between waves), and re-runs the full suite on `main`.

## Definition of done (v1 release)

- `pnpm cuep3d build samples/Avocado.glb -o out/avocado` produces a valid manifest, three tiers, AV1 + VP9 + AVIF proxies; `assert-free-codecs` passes.
- Demo on GitHub Pages shows plain vs CueP3D side by side with live metrics for three models.
- `BENCHMARKS.md` shows TTFV ≤ 500 ms and TTI ≤ 3 s on `3g-fast` for all three models, with plain-mode numbers alongside.
- Handoff pixel-diff test and long-task test pass in CI.
- README contains: problem, demo GIF, how it works diagram, quick start, codec policy (accurate), prior art, limitations, roadmap, licenses of sample assets.
