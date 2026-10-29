import type { Browser } from 'playwright';
import { toEmulateNetworkConditions, type NetworkPreset } from './presets.js';
import type { BenchMode, BenchModel } from './models.js';
import type { CaseResult, MetricsSnapshot, WallClockTimings } from './metrics-snapshot.js';

const TERMINAL_STATE: Record<BenchMode, string> = {
  plain: 'rendered',
  understudy: 'settled',
};

// Both Plain and Understudy can end in a visible failure state rather than
// hang — treated as a hard failure (thrown), not a silently-skipped row:
// this project's testing culture is "run the real thing", and a case that
// can't reach its terminal state is a real bug worth seeing, not noise to
// average away.
const FAILURE_STATES = new Set(['error', 'blocked']);

const POLL_INTERVAL_MS = 100;

// Understudy's 'settled' state requires every tier (L0+L1+L2, each a
// self-contained .glb per D-008) to finish downloading — at Avocado's sizes
// that's roughly 11.8 MB total. At 3g-fast (1.6 Mbps ≈ 200 KB/s) that alone
// is ~59 s; Plain's single original .glb (~8-10.6 MB) is a similar order of
// magnitude. wifi/4g are both well under a minute for either mode.
const TIMEOUT_MS_BY_PRESET: Record<NetworkPreset['id'], number> = {
  wifi: 20_000,
  '4g': 30_000,
  '3g-fast': 150_000,
};

export interface RunCaseOptions {
  readonly baseUrl: string;
  readonly preset: NetworkPreset;
  readonly model: BenchModel;
  readonly mode: BenchMode;
}

interface PageSnapshot {
  state?: string | undefined;
  metrics?: MetricsSnapshot | undefined;
}

export async function runCase(browser: Browser, options: RunCaseOptions): Promise<CaseResult> {
  const { baseUrl, preset, model, mode } = options;
  const timeoutMs = TIMEOUT_MS_BY_PRESET[preset.id];
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', toEmulateNetworkConditions(preset));

    const url = new URL(baseUrl);
    url.searchParams.set('model', model.slug);
    url.searchParams.set('mode', mode);
    url.searchParams.set('debug', '1');

    const navStart = Date.now();
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    const terminal = TERMINAL_STATE[mode];
    const deadline = Date.now() + timeoutMs;
    let snapshot: PageSnapshot = {};
    let wallTtfv: number | undefined;
    let wallTti: number | undefined;
    while (Date.now() < deadline) {
      snapshot = await page.evaluate<PageSnapshot>(() => ({
        state: window.__understudyState,
        metrics: window.__understudyMetrics,
      }));
      if (wallTtfv === undefined && snapshot.metrics?.ttfv !== undefined) {
        wallTtfv = Date.now() - navStart;
      }
      if (wallTti === undefined && snapshot.metrics?.tti !== undefined) {
        wallTti = Date.now() - navStart;
      }
      if (snapshot.state === terminal || (snapshot.state && FAILURE_STATES.has(snapshot.state))) {
        break;
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
    const wallClockMs: WallClockTimings = {
      ttfv: wallTtfv,
      tti: wallTti,
      terminal: Date.now() - navStart,
    };

    const label = `${model.slug}/${mode}/${preset.id}`;
    if (!snapshot.state) {
      throw new Error(
        `bench: ${label} never set window.__understudyState within ${String(timeoutMs)}ms`,
      );
    }
    if (snapshot.state !== terminal) {
      throw new Error(`bench: ${label} ended in state "${snapshot.state}", expected "${terminal}"`);
    }
    if (!snapshot.metrics) {
      throw new Error(
        `bench: ${label} reached "${terminal}" but window.__understudyMetrics is unset`,
      );
    }
    return { state: snapshot.state, metrics: snapshot.metrics, wallClockMs };
  } finally {
    await context.close();
  }
}
