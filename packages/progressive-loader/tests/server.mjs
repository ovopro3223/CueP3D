#!/usr/bin/env node
/**
 * Static server + esbuild bundle for the Playwright test harness. Serves:
 *   /                    -> index.html (loads the bundled harness)
 *   /harness.js          -> esbuild bundle of tests/harness.ts (bundles
 *                           three, @cuep3d/stage, @cuep3d/manifest
 *                           and this package's own src/ in one IIFE)
 *   /basis/*              -> three's own Basis Universal transcoder (ships
 *                           in three/examples/jsm/libs/basis, same files
 *                           the real build/viewer would self-host per D-005)
 *   /fixtures/*           -> the repo's shared fixtures/ directory
 *
 * Launched by playwright.config.ts as the `webServer` command.
 */
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');
const repoRoot = path.join(packageRoot, '..', '..');
const basisDir = path.join(
  packageRoot,
  'node_modules',
  'three',
  'examples',
  'jsm',
  'libs',
  'basis',
);
const fixturesDir = path.join(repoRoot, 'fixtures');

const PORT = Number(process.env.PL_TEST_PORT ?? 4319);

const INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>progressive-loader test harness</title></head>
  <body><script src="/harness.js"></script></body>
</html>
`;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
};

async function buildHarness() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'harness.ts')],
    outfile: 'harness.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output for harness.ts');
  return file.text;
}

async function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const body = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
  res.end(body);
}

export async function startServer() {
  const harnessJs = await buildHarness();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] });
        res.end(INDEX_HTML);
        return;
      }

      if (url.pathname === '/harness.js') {
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'] });
        res.end(harnessJs);
        return;
      }

      if (url.pathname.startsWith('/basis/')) {
        const filePath = path.join(basisDir, url.pathname.slice('/basis/'.length));
        await serveFile(res, filePath);
        return;
      }

      if (url.pathname.startsWith('/fixtures/')) {
        const filePath = path.join(fixturesDir, url.pathname.slice('/fixtures/'.length));
        await serveFile(res, filePath);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(PORT, resolve));
  return {
    url: `http://localhost:${PORT}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function fixtureStats(name) {
  const filePath = path.join(fixturesDir, name);
  const { size } = await stat(filePath);
  return { size };
}

const { url } = await startServer();
console.log(`progressive-loader test harness listening on ${url}`);
