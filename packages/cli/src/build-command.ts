import type { BuildArgs } from './parse-build-args.js';

export class NotImplementedError extends Error {}

/**
 * Orchestrates P1 (build-geometry) -> P2 (build-proxy) -> P3 (build-encode)
 * and assembles understudy.json. Wired in Wave 2 once those packages land
 * (see docs/02-plan.md); this stub exists so the CLI's argument parsing and
 * help text can be built and tested in Wave 0.
 */
export async function runBuild(args: BuildArgs): Promise<void> {
  void args;
  throw new NotImplementedError(
    'understudy build is not wired yet. packages/build-geometry, build-proxy and ' +
      'build-encode land in Wave 1; packages/cli wires them together in Wave 2. ' +
      'See docs/02-plan.md.',
  );
}
