import type { SweepReport, SweepCell } from './types.js';
import { formatBytes, formatMs } from './format.js';

const TABLE_HEADER =
  '| Model | Mode | State | TTFV | Wall TTFV | First video frame | TTI | Wall TTI | Time to live | Time to settled | Bytes before first visual | Bytes total |';
const TABLE_DIVIDER = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function renderRow(cell: SweepCell, modelLabel: string): string {
  const { medianResult } = cell;
  const { metrics, wallClockMs } = medianResult;
  return (
    `| ${modelLabel} | ${cell.mode} | ${medianResult.state} | ${formatMs(metrics.ttfv)} | ` +
    `${formatMs(wallClockMs.ttfv)} | ${formatMs(metrics.ttProxyFrame)} | ${formatMs(metrics.tti)} | ` +
    `${formatMs(wallClockMs.tti)} | ` +
    `${formatMs(metrics.ttLive)} | ${formatMs(metrics.ttSettled)} | ` +
    `${formatBytes(metrics.bytesBeforeFirstVisual)} | ${formatBytes(metrics.bytesTotal)} |`
  );
}

export function renderBenchmarksMarkdown(report: SweepReport): string {
  const lines: string[] = [];
  lines.push('# BENCHMARKS');
  lines.push('');
  lines.push(
    `Generated ${report.dateIso} — commit \`${report.commitHash}\` — Chromium ${report.chromiumVersion}`,
  );
  lines.push('');
  lines.push(
    '3 runs per cell, median reported (bench/src/median.ts). Goals (docs/01-design.md §3): ' +
      'CueP3D TTFV ≤ 500 ms and TTI ≤ 3000 ms on `3g-fast`, for every model.',
  );
  lines.push('');
  lines.push(
    "`TTFV`/`TTI` are the viewer's own internal marks (`window.__cuep3dMetrics`), timed " +
      "from `createViewer()`'s own construction — they exclude however long the page's JS " +
      'bundle itself took to fetch/parse/execute first. `Wall TTFV`/`Wall TTI` are the same two ' +
      "marks timed from navigation start instead (what a real visitor's clock would show); see " +
      'docs/reports/P7b-report.md for why the two differ. For CueP3D, `TTFV` is the inline ' +
      'poster carried by the manifest (frame 0 as an AVIF still, D-014) and `First video frame` ' +
      'is the first decoded frame of the AV1 proxy — the number `TTFV` reported before D-014; ' +
      '`Bytes before first visual` is then the manifest itself (poster included). ' +
      'Plain has no poster or proxy, so that column is empty for it.',
  );
  lines.push('');
  lines.push('## Presets');
  lines.push('');
  lines.push('| Preset | Download | Upload | RTT |');
  lines.push('| --- | --- | --- | --- |');
  for (const preset of report.presets) {
    lines.push(
      `| \`${preset.id}\` | ${preset.downloadMbps} Mbps | ${preset.uploadMbps} Mbps | ${preset.rttMs} ms |`,
    );
  }
  lines.push('');

  for (const preset of report.presets) {
    lines.push(`## ${preset.label}`);
    lines.push('');
    lines.push(TABLE_HEADER);
    lines.push(TABLE_DIVIDER);
    for (const model of report.models) {
      const cellsForModel = report.cells.filter(
        (c) => c.presetId === preset.id && c.modelSlug === model.slug,
      );
      for (const cell of cellsForModel) {
        lines.push(renderRow(cell, model.label));
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
