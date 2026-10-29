import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { NETWORK_PRESETS } from './presets.js';
import { BENCH_MODELS, BENCH_MODES } from './models.js';
import { runCase } from './run-case.js';
import { medianCaseResult } from './median.js';
import { startDemoServer, REPO_ROOT } from './server.js';
import type { SweepCell, SweepReport } from './types.js';

const RUNS_PER_CELL = 3;
const PORT = 4591;

// Matches packages/viewer/e2e/playwright.config.ts's launch flags: only
// matters on a GPU-less runner falling back to software rendering.
const LAUNCH_ARGS = ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

function commitHash(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT })
    .toString()
    .trim();
}

export interface RunSweepOptions {
  readonly runsPerCell?: number;
  readonly onProgress?: (message: string) => void;
}

export async function runSweep(options: RunSweepOptions = {}): Promise<SweepReport> {
  const runsPerCell = options.runsPerCell ?? RUNS_PER_CELL;
  const log = options.onProgress ?? ((): void => {});

  log('building and starting apps/demo (production build, vite preview)...');
  const server = await startDemoServer(PORT);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });

  try {
    const chromiumVersion = browser.version();
    const cells: SweepCell[] = [];
    for (const preset of NETWORK_PRESETS) {
      for (const model of BENCH_MODELS) {
        for (const mode of BENCH_MODES) {
          log(`${preset.id} / ${model.slug} / ${mode}: running ${String(runsPerCell)}x...`);
          const runs = [];
          for (let i = 0; i < runsPerCell; i++) {
            runs.push(await runCase(browser, { baseUrl: server.baseUrl, preset, model, mode }));
          }
          const medianResult = medianCaseResult(runs);
          log(
            `${preset.id} / ${model.slug} / ${mode}: median ttfv=${String(medianResult.metrics.ttfv)}ms ` +
              `tti=${String(medianResult.metrics.tti)}ms state=${medianResult.state}`,
          );
          cells.push({ presetId: preset.id, modelSlug: model.slug, mode, runs, medianResult });
        }
      }
    }
    return {
      commitHash: commitHash(),
      chromiumVersion,
      dateIso: new Date().toISOString(),
      presets: NETWORK_PRESETS,
      models: BENCH_MODELS,
      cells,
    };
  } finally {
    await browser.close();
    await server.stop();
  }
}
