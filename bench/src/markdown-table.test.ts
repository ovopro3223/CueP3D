import { describe, expect, it } from 'vitest';
import { renderBenchmarksMarkdown } from './markdown-table.js';
import { NETWORK_PRESETS } from './presets.js';
import { BENCH_MODELS } from './models.js';
import type { SweepReport } from './types.js';

function buildReport(): SweepReport {
  return {
    commitHash: 'c7d4369',
    chromiumVersion: '131.0.6778.33',
    dateIso: '2026-10-29T00:00:00.000Z',
    presets: NETWORK_PRESETS,
    models: BENCH_MODELS,
    cells: [
      {
        presetId: '3g-fast',
        modelSlug: 'avocado',
        mode: 'cuep3d',
        runs: [],
        medianResult: {
          state: 'settled',
          metrics: {
            ttfv: 113,
            tti: 114,
            ttLive: 400,
            ttSettled: 613,
            bytesBeforeFirstVisual: 154223,
            bytesTotal: 11829627,
          },
          wallClockMs: { ttfv: 1850, tti: 1851, terminal: 2500 },
        },
      },
      {
        presetId: '3g-fast',
        modelSlug: 'avocado',
        mode: 'plain',
        runs: [],
        medianResult: {
          state: 'rendered',
          metrics: { ttfv: 243, tti: 243, bytesBeforeFirstVisual: 8110040, bytesTotal: 8110040 },
          wallClockMs: { ttfv: 1950, tti: 1950, terminal: 1950 },
        },
      },
    ],
  };
}

describe('renderBenchmarksMarkdown', () => {
  it('includes commit hash, Chromium version, and date', () => {
    const md = renderBenchmarksMarkdown(buildReport());
    expect(md).toContain('c7d4369');
    expect(md).toContain('131.0.6778.33');
    expect(md).toContain('2026-10-29T00:00:00.000Z');
  });

  it('includes a section per preset with the preset definitions', () => {
    const md = renderBenchmarksMarkdown(buildReport());
    expect(md).toContain('## 3g-fast (1.6 Mbps / 150 ms)');
    expect(md).toContain('| `3g-fast` | 1.6 Mbps | 1.6 Mbps | 150 ms |');
  });

  it('renders a row per model/mode cell with formatted viewer-internal and wall-clock metrics', () => {
    const md = renderBenchmarksMarkdown(buildReport());
    expect(md).toContain(
      '| Avocado | cuep3d | settled | 113 ms | 1850 ms | 114 ms | 1851 ms | 400 ms | 613 ms |',
    );
    expect(md).toContain(
      '| Avocado | plain | rendered | 243 ms | 1950 ms | 243 ms | 1950 ms | — | — |',
    );
  });

  it('formats byte counts in human-readable units', () => {
    const md = renderBenchmarksMarkdown(buildReport());
    expect(md).toContain('7.73 MB');
  });
});
