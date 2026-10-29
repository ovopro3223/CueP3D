import { describe, expect, it } from 'vitest';
import { checkGoals } from './goals.js';
import { NETWORK_PRESETS } from './presets.js';
import { BENCH_MODELS } from './models.js';
import type { SweepReport, SweepCell } from './types.js';
import type { CaseResult } from './metrics-snapshot.js';

function caseResult(ttfv: number, tti: number): CaseResult {
  return {
    state: 'settled',
    metrics: { ttfv, tti, bytesBeforeFirstVisual: 0, bytesTotal: 0 },
    wallClockMs: { terminal: 0 },
  };
}

function cell(overrides: Partial<SweepCell>): SweepCell {
  return {
    presetId: '3g-fast',
    modelSlug: 'avocado',
    mode: 'understudy',
    runs: [],
    medianResult: caseResult(150, 200),
    ...overrides,
  };
}

function report(cells: SweepCell[]): SweepReport {
  return {
    commitHash: 'abc1234',
    chromiumVersion: '131.0.0.0',
    dateIso: '2026-10-29T00:00:00.000Z',
    presets: NETWORK_PRESETS,
    models: BENCH_MODELS,
    cells,
  };
}

describe('checkGoals', () => {
  it('reports no violations when understudy is within budget on 3g-fast', () => {
    expect(checkGoals(report([cell({})]))).toEqual([]);
  });

  it('flags a TTFV over 500ms on 3g-fast for understudy', () => {
    const violations = checkGoals(report([cell({ medianResult: caseResult(600, 200) })]));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ metric: 'ttfv', valueMs: 600, limitMs: 500 });
  });

  it('flags a TTI over 3000ms on 3g-fast for understudy', () => {
    const violations = checkGoals(report([cell({ medianResult: caseResult(100, 3500) })]));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ metric: 'tti', valueMs: 3500, limitMs: 3000 });
  });

  it('ignores Plain mode and other presets entirely', () => {
    const violations = checkGoals(
      report([
        cell({ mode: 'plain', medianResult: caseResult(50000, 50000) }),
        cell({ presetId: 'wifi', medianResult: caseResult(50000, 50000) }),
      ]),
    );
    expect(violations).toEqual([]);
  });
});
