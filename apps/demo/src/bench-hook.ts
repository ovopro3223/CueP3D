/**
 * The bench harness (`bench/`) loads this page as `/?model=…&mode=plain|
 * understudy&debug=1` and reads `window.__understudyMetrics` /
 * `window.__understudyState` (docs/01-design.md §9's debug-hook convention;
 * `packages/viewer`'s own `ViewerOptions.debug` sets the same global, but
 * only from inside `createViewer` — the demo's custom-element usage doesn't
 * route `debug`/`policy` through to it, see docs/reports/P7a-report.md's
 * open question #1, so this mirrors the same convention from the pane level
 * instead). Shape matches `ViewerMetrics` for both panes so one bench
 * reader works for both; Plain has no tiering, so `tti` is just a copy of
 * `ttfv` and `ttLive`/`ttSettled` stay unset (docs/01-design.md §10: "first
 * render = TTFV = TTI").
 */
export interface BenchMetricsSnapshot {
  ttfv?: number | undefined;
  tti?: number | undefined;
  ttLive?: number | undefined;
  ttSettled?: number | undefined;
  bytesBeforeFirstVisual: number;
  bytesTotal: number;
}

declare global {
  interface Window {
    __understudyMetrics?: BenchMetricsSnapshot;
    __understudyState?: string;
  }
}

export function exposeBenchState(state: string, metrics: BenchMetricsSnapshot): void {
  window.__understudyState = state;
  window.__understudyMetrics = metrics;
}
