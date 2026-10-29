#!/usr/bin/env node
/**
 * Bundles page/render-page.ts into a single standalone ESM file the static
 * server hands to headless Chromium. esbuild only (brief: "Vite library
 * mode or esbuild at package build time"); it does not type-check — run
 * `tsc -p page/tsconfig.json --noEmit` (wired into the package's typecheck
 * script) for that.
 */
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist', 'page');

async function main() {
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, 'page', 'render-page.ts')],
    outfile: path.join(outDir, 'render-page.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
  });

  await copyFile(
    path.join(root, 'page', 'render-page.html'),
    path.join(outDir, 'render-page.html'),
  );

  console.log('built dist/page/render-page.js');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
