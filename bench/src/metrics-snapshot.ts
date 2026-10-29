/**
 * Mirrors apps/demo/src/bench-hook.ts's `BenchMetricsSnapshot` (the shape
 * written to `window.__understudyMetrics`), which in turn mirrors
 * `packages/viewer`'s frozen `ViewerMetrics` (docs/01-design.md §5.6).
 * Duplicated rather than imported: the demo exposes it at runtime through a
 * page global, not as a module export this Node-side package could import.
 */
export interface MetricsSnapshot {
  ttfv?: number | undefined;
  tti?: number | undefined;
  ttLive?: number | undefined;
  ttSettled?: number | undefined;
  bytesBeforeFirstVisual: number;
  bytesTotal: number;
}

/**
 * `MetricsSnapshot.ttfv`/`tti` are `performance.now()` deltas from
 * `createViewer()`'s own construction (packages/viewer/src/metrics.ts's
 * `t0`) — they exclude however long the page's JS bundle itself took to
 * fetch, parse and execute before that constructor ever ran (for
 * Understudy specifically, that also includes a *second*, dynamic
 * `import('@understudy3d/viewer')` the bundle doesn't make until
 * `understudy-pane.ts` runs). `wallClockMs` is this harness's own
 * supplementary measurement of the same two marks, timed from
 * `page.goto()` instead — i.e. what a real visitor's clock would show. Both
 * are reported; see docs/reports/P7b-report.md for why this gap matters
 * for the project's own §3 goal ("TTFV ... after HTML parse").
 */
export interface WallClockTimings {
  ttfv?: number | undefined;
  tti?: number | undefined;
  terminal: number;
}

export interface CaseResult {
  readonly state: string;
  readonly metrics: MetricsSnapshot;
  readonly wallClockMs: WallClockTimings;
}

// Matches apps/demo/src/bench-hook.ts's `declare global` — this file's
// `page.evaluate()` callbacks (run-case.ts) read these off the real page.
declare global {
  interface Window {
    __understudyMetrics?: MetricsSnapshot;
    __understudyState?: string;
  }
}
