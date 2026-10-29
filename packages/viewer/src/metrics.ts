import type { ViewerMetrics } from './types.js';

/**
 * Tracks the four timing marks (§5.6) as `performance.now()` deltas from
 * the moment `createViewer` was called, plus the two byte counters. Also
 * writes real `performance.mark()`s (`understudy:ttfv` etc.) so the marks
 * show up in DevTools/CDP traces, independent of the metrics object itself.
 */
export function createMetricsTracker(t0: number) {
  const metrics: ViewerMetrics = { bytesBeforeFirstVisual: 0, bytesTotal: 0 };

  function mark(name: string): void {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      try {
        performance.mark(name);
      } catch {
        // performance.mark can throw on some restricted/old embedders; the
        // metrics object itself is the source of truth, this is a bonus.
      }
    }
  }

  function now(): number {
    return performance.now() - t0;
  }

  return {
    snapshot(): ViewerMetrics {
      return { ...metrics };
    },
    markTtfv(bytesBeforeFirstVisual: number): void {
      metrics.ttfv = now();
      metrics.bytesBeforeFirstVisual = bytesBeforeFirstVisual;
      mark('understudy:ttfv');
    },
    markTti(): void {
      if (metrics.tti !== undefined) return;
      metrics.tti = now();
      mark('understudy:tti');
    },
    markTtLive(bytesBeforeFirstVisualIfDegraded?: number): void {
      metrics.ttLive = now();
      if (bytesBeforeFirstVisualIfDegraded !== undefined) {
        metrics.bytesBeforeFirstVisual = bytesBeforeFirstVisualIfDegraded;
      }
      mark('understudy:ttLive');
    },
    markTtSettled(): void {
      metrics.ttSettled = now();
      mark('understudy:ttSettled');
    },
    setBytesTotal(bytes: number): void {
      metrics.bytesTotal = bytes;
    },
  };
}

export type MetricsTracker = ReturnType<typeof createMetricsTracker>;
