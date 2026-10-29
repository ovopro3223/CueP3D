#!/usr/bin/env node
/**
 * Enforces D-005 ("only free, open-source tooling") across the full
 * dependency tree: runs `pnpm licenses list --json` and fails on any
 * license not in the allowlist below. The allowlist is exactly the set
 * this repo's tree used as of 2026-10-29 (verified by running the command
 * and reading its output) plus the one documented LGPL exception (D-005b:
 * a transitive native dependency, invoked as a separate process/library,
 * never statically linked into anything shipped — same reasoning as the
 * ffmpeg carve-out).
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later', // D-005b: sharp/libvips, transitive via @gltf-transform/functions
  'Python-2.0',
  'ISC',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'BlueOak-1.0.0',
  '0BSD',
]);

async function main() {
  // exec (not execFile) — on Windows, pnpm is a .cmd/.ps1 shim that needs a
  // shell to resolve; exec always goes through one.
  const { stdout } = await execAsync('pnpm licenses list --json', {
    maxBuffer: 1024 * 1024 * 32,
  });
  const byLicense = JSON.parse(stdout);

  const violations = [];
  for (const [license, packages] of Object.entries(byLicense)) {
    if (ALLOWED.has(license)) continue;
    for (const pkg of packages) {
      violations.push(`${pkg.name}@${pkg.versions.join(',')}: "${license}"`);
    }
  }

  if (violations.length > 0) {
    console.error('License policy violations (D-005 — free, open-source tooling only):\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `\nIf this is a legitimate new free license, add it to ALLOWED in ${import.meta.filename ?? 'scripts/check-licenses.mjs'} with a one-line reason.`,
    );
    process.exitCode = 1;
    return;
  }

  const total = Object.values(byLicense).reduce((n, pkgs) => n + pkgs.length, 0);
  console.log(
    `check-licenses: clean (${total} packages, ${Object.keys(byLicense).length} license types).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
