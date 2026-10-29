import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

type Route = { filePath: string } | { bytes: Uint8Array; contentType: string };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

export interface StaticServerHandle {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/**
 * Serves the bundled render page, the three.js KTX2 transcoder, and the
 * in-memory model bytes over plain HTTP on an ephemeral localhost port.
 * No external network — everything is read from disk or passed in by the
 * caller (design doc §7 step 2, brief "Implementation notes").
 */
export async function startStaticServer(opts: {
  modelBytes: Uint8Array;
}): Promise<StaticServerHandle> {
  const pageDir = path.join(packageRoot, 'dist', 'page');
  const basisDir = path.dirname(
    require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'),
  );

  const routes = new Map<string, Route>([
    ['/render-page.html', { filePath: path.join(pageDir, 'render-page.html') }],
    ['/render-page.js', { filePath: path.join(pageDir, 'render-page.js') }],
    ['/render-page.js.map', { filePath: path.join(pageDir, 'render-page.js.map') }],
    ['/basis/basis_transcoder.js', { filePath: path.join(basisDir, 'basis_transcoder.js') }],
    ['/basis/basis_transcoder.wasm', { filePath: path.join(basisDir, 'basis_transcoder.wasm') }],
    ['/model.glb', { bytes: opts.modelBytes, contentType: 'model/gltf-binary' }],
  ]);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const route = routes.get(pathname);
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    if ('bytes' in route) {
      res.writeHead(200, {
        'content-type': route.contentType,
        'content-length': route.bytes.byteLength,
      });
      res.end(route.bytes);
      return;
    }
    const data = await readFile(route.filePath);
    res.writeHead(200, {
      'content-type': contentTypeFor(route.filePath),
      'content-length': data.byteLength,
    });
    res.end(data);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(error instanceof Error ? (error.stack ?? error.message) : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
