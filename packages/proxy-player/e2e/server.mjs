#!/usr/bin/env node
/**
 * Minimal static file server for the Playwright harness: the proxy-player
 * test fixtures, this package's own compiled dist/, the harness page, and
 * vendored copies of its two bare-specifier runtime deps (mp4box, and
 * manifest -> zod) so the browser can resolve them via an import map
 * without a bundler. Serves Range requests for real (206 + Content-Range)
 * since codec-support.ts and mp4-source.ts's metadata probes use them, and
 * the streaming test needs partial responses to be meaningful.
 */
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');
const repoRoot = path.join(pkgRoot, '..', '..');
const nodeModules = path.join(repoRoot, 'node_modules', '.pnpm');

const PORT = Number(process.env.PORT ?? 4873);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.avif': 'image/avif',
  '.png': 'image/png',
};

function contentType(filePath) {
  return MIME[path.extname(filePath)] ?? 'application/octet-stream';
}

async function resolvePnpmDep(name) {
  const entries = await fs.readdir(nodeModules);
  const prefix = `${name}@`;
  const match = entries.find((entry) => entry.startsWith(prefix));
  if (!match) throw new Error(`Could not find ${name} under ${nodeModules}`);
  return path.join(nodeModules, match, 'node_modules', name);
}

const routes = [];

async function buildRoutes() {
  const mp4boxDir = await resolvePnpmDep('mp4box');
  const zodDir = await resolvePnpmDep('zod');
  routes.push(
    { prefix: '/harness/', dir: path.join(__dirname, 'harness') },
    { prefix: '/dist/', dir: path.join(pkgRoot, 'dist') },
    { prefix: '/fixtures/', dir: path.join(repoRoot, 'fixtures') },
    { prefix: '/generated/', dir: path.join(__dirname, '.generated') },
    { prefix: '/vendor/mp4box/', dir: path.join(mp4boxDir, 'dist') },
    { prefix: '/vendor/zod/', dir: zodDir },
    { prefix: '/vendor/manifest/', dir: path.join(repoRoot, 'packages', 'manifest', 'dist') },
  );
}

function resolveRoute(urlPath) {
  for (const route of routes) {
    if (urlPath.startsWith(route.prefix)) {
      const rel = urlPath.slice(route.prefix.length);
      return path.join(route.dir, rel);
    }
  }
  if (urlPath === '/' || urlPath === '/index.html') {
    return path.join(__dirname, 'harness', 'index.html');
  }
  return undefined;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match) return undefined;
  const [, startStr, endStr] = match;
  let start = startStr ? Number(startStr) : undefined;
  let end = endStr ? Number(endStr) : undefined;
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined) {
    start = Math.max(0, size - (end ?? 0));
    end = size - 1;
  } else if (end === undefined || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) return undefined;
  return { start, end };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const filePath = resolveRoute(decodeURIComponent(url.pathname));
    if (!filePath) {
      res.writeHead(404).end('Not found');
      return;
    }
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat || !stat.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const headers = {
      'Content-Type': contentType(filePath),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    const range = parseRange(req.headers.range, stat.size);
    if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': String(range.end - range.start + 1),
      });
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(stat.size) });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

await fs.mkdir(path.join(__dirname, '.generated'), { recursive: true });
await buildRoutes();

server.listen(PORT, () => {
  console.log(`proxy-player e2e server listening on http://localhost:${PORT}`);
});
