import type { CaseResult, MetricsSnapshot, WallClockTimings } from './metrics-snapshot.js';

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) return undefined;
  return (lo + hi) / 2;
}

const METRIC_FIELDS = ['ttfv', 'tti', 'ttLive', 'ttSettled'] as const;

function medianOfDefined(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return median(defined);
}

export function medianMetrics(snapshots: readonly MetricsSnapshot[]): MetricsSnapshot {
  const result: MetricsSnapshot = {
    bytesBeforeFirstVisual: median(snapshots.map((s) => s.bytesBeforeFirstVisual)) ?? 0,
    bytesTotal: median(snapshots.map((s) => s.bytesTotal)) ?? 0,
  };
  for (const field of METRIC_FIELDS) {
    const value = medianOfDefined(snapshots.map((s) => s[field]));
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export function medianWallClock(timings: readonly WallClockTimings[]): WallClockTimings {
  return {
    ttfv: medianOfDefined(timings.map((t) => t.ttfv)),
    tti: medianOfDefined(timings.map((t) => t.tti)),
    terminal: median(timings.map((t) => t.terminal)) ?? 0,
  };
}

/** Most frequent terminal state across runs; ties broken by first occurrence. */
export function modeState(states: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  let best = states[0] ?? 'unknown';
  let bestCount = 0;
  for (const state of states) {
    const count = counts.get(state) ?? 0;
    if (count > bestCount) {
      best = state;
      bestCount = count;
    }
  }
  return best;
}

export function medianCaseResult(results: readonly CaseResult[]): CaseResult {
  return {
    state: modeState(results.map((r) => r.state)),
    metrics: medianMetrics(results.map((r) => r.metrics)),
    wallClockMs: medianWallClock(results.map((r) => r.wallClockMs)),
  };
}
