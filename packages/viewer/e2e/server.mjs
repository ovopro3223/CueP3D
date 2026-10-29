#!/usr/bin/env node
/**
 * Static server + esbuild bundle for the Playwright harness (mirrors
 * packages/progressive-loader/tests/server.mjs). Serves:
 *   /                     -> index.html (loads the bundled harness)
 *   /harness.js           -> esbuild bundle of harness/harness.ts (bundles
 *                            three, every @understudy3d/* workspace dep and
 *                            this package's own src/ into one IIFE)
 *   /fixtures/*            -> the repo's shared fixtures/ directory
 *   /fixtures/out-cube/basis/* -> three's own Basis Universal transcoder,
 *                            since this fixture's manifest resolves
 *                            `ktx2TranscoderPath` relative to its own URL
 *                            (create-viewer.ts: `resolveUrl(manifestUrl,
 *                            'basis/')`) — the real viewer expects a
 *                            `basis/` directory served next to the
 *                            manifest it's pointed at.
 */
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

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

const PORT = Number(process.env.VIEWER_TEST_PORT ?? 4517);

const INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>viewer test harness</title></head>
  <body><script src="/harness.js"></script></body>
</html>
`;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.avif': 'image/avif',
  '.png': 'image/png',
};

async function buildHarness() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'harness', 'harness.ts')],
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

      if (url.pathname.startsWith('/fixtures/out-cube/basis/')) {
        const filePath = path.join(
          basisDir,
          url.pathname.slice('/fixtures/out-cube/basis/'.length),
        );
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
console.log(`viewer e2e test harness listening on ${url}`);
