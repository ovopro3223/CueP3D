import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DEMO_DIR = path.join(REPO_ROOT, 'apps', 'demo');

const REQUIRED_MODEL_SLUGS = ['avocado', 'boombox', 'waterbottle'] as const;

export function assertDemoAssetsBuilt(): void {
  for (const slug of REQUIRED_MODEL_SLUGS) {
    const manifestPath = path.join(DEMO_DIR, 'public', 'models', slug, 'understudy.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `bench: missing ${manifestPath}. From the repo root, run "pnpm run fetch-samples" ` +
          'then "pnpm run demo:assets" before benchmarking (see the P7b brief, hard-won lesson 1).',
      );
    }
  }
}

export interface DemoServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Serves apps/demo's real production build (`vite build` then `vite
 * preview`), not the dev server — the brief is explicit that bench numbers
 * must reflect production, not Vite's dev-mode transform overhead (hard-won
 * lesson 2 in the brief is a reminder of how differently the dev server
 * behaves for missing assets). Uses Vite's own JS API (`build`/`preview`)
 * rather than spawning `pnpm`/`vite` as a child process, which avoids
 * Windows shell/`.cmd`-resolution entirely.
 *
 * Base path is forced to "/" (instead of apps/demo/vite.config.ts's GitHub
 * Pages default, "/understudy/") by setting UNDERSTUDY_DEMO_BASE before
 * that config file is evaluated, purely so bench URLs stay simple
 * (`/?model=…`). This has no effect on the real Pages deploy, which sets
 * its own value for that env var in CI.
 */
export async function startDemoServer(port: number): Promise<DemoServer> {
  assertDemoAssetsBuilt();
  process.env.UNDERSTUDY_DEMO_BASE = process.env.UNDERSTUDY_DEMO_BASE ?? '/';
  const configFile = path.join(DEMO_DIR, 'vite.config.ts');
  const { build, preview } = await import('vite');
  await build({ root: DEMO_DIR, configFile, logLevel: 'warn' });
  const server = await preview({
    root: DEMO_DIR,
    configFile,
    logLevel: 'warn',
    preview: { port, strictPort: true },
  });
  const local = server.resolvedUrls?.local[0];
  if (!local) throw new Error('bench: vite preview did not report a local URL to bind to');
  return {
    baseUrl: local,
    stop: () => server.close(),
  };
}
