import { describe, expect, it } from 'vitest';
import { median, medianMetrics, medianWallClock, medianCaseResult, modeState } from './median.js';
import type { CaseResult, MetricsSnapshot, WallClockTimings } from './metrics-snapshot.js';

describe('median', () => {
  it('returns undefined for an empty array', () => {
    expect(median([])).toBeUndefined();
  });

  it('returns the middle value for an odd-length array', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is unaffected by input order', () => {
    expect(median([300, 100, 200])).toBe(200);
  });
});

describe('medianMetrics', () => {
  it('takes the per-field median across snapshots', () => {
    const snapshots: MetricsSnapshot[] = [
      { ttfv: 100, tti: 100, bytesBeforeFirstVisual: 1000, bytesTotal: 2000 },
      { ttfv: 120, tti: 150, bytesBeforeFirstVisual: 1100, bytesTotal: 2100 },
      { ttfv: 110, tti: 130, bytesBeforeFirstVisual: 1050, bytesTotal: 2050 },
    ];
    const result = medianMetrics(snapshots);
    expect(result.ttfv).toBe(110);
    expect(result.tti).toBe(130);
    expect(result.bytesBeforeFirstVisual).toBe(1050);
    expect(result.bytesTotal).toBe(2050);
  });

  it('omits a field entirely when no run defined it (Plain has no ttLive/ttSettled)', () => {
    const snapshots: MetricsSnapshot[] = [
      { ttfv: 100, tti: 100, bytesBeforeFirstVisual: 1000, bytesTotal: 1000 },
      { ttfv: 110, tti: 110, bytesBeforeFirstVisual: 1010, bytesTotal: 1010 },
      { ttfv: 105, tti: 105, bytesBeforeFirstVisual: 1005, bytesTotal: 1005 },
    ];
    const result = medianMetrics(snapshots);
    expect(result.ttLive).toBeUndefined();
    expect(result.ttSettled).toBeUndefined();
  });
});

describe('medianWallClock', () => {
  it('takes the per-field median, keeping ttfv/tti undefined when always unset', () => {
    const timings: WallClockTimings[] = [
      { ttfv: 1200, tti: 1300, terminal: 2000 },
      { ttfv: 1400, tti: 1500, terminal: 2200 },
      { ttfv: 1300, tti: 1400, terminal: 2100 },
    ];
    const result = medianWallClock(timings);
    expect(result.ttfv).toBe(1300);
    expect(result.tti).toBe(1400);
    expect(result.terminal).toBe(2100);
  });
});

describe('modeState', () => {
  it('picks the most frequent state', () => {
    expect(modeState(['settled', 'settled', 'live'])).toBe('settled');
  });

  it('falls back to the first state on a three-way tie', () => {
    expect(modeState(['live', 'settled', 'error'])).toBe('live');
  });
});

describe('medianCaseResult', () => {
  it('combines medianMetrics and modeState', () => {
    const results: CaseResult[] = [
      {
        state: 'settled',
        metrics: { ttfv: 100, bytesBeforeFirstVisual: 10, bytesTotal: 20 },
        wallClockMs: { ttfv: 1200, terminal: 2000 },
      },
      {
        state: 'settled',
        metrics: { ttfv: 120, bytesBeforeFirstVisual: 12, bytesTotal: 22 },
        wallClockMs: { ttfv: 1400, terminal: 2200 },
      },
      {
        state: 'settled',
        metrics: { ttfv: 110, bytesBeforeFirstVisual: 11, bytesTotal: 21 },
        wallClockMs: { ttfv: 1300, terminal: 2100 },
      },
    ];
    const combined = medianCaseResult(results);
    expect(combined.state).toBe('settled');
    expect(combined.metrics.ttfv).toBe(110);
  });
});
