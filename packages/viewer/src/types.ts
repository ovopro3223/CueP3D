import type { QualityPolicyOptions } from './quality-policy.js';
import type { ViewerState } from './state-machine.js';

export type { ViewerState };

export interface ViewerMetrics {
  ttfv?: number;
  tti?: number;
  ttLive?: number;
  ttSettled?: number;
  bytesBeforeFirstVisual: number;
  bytesTotal: number;
}

/**
 * Frozen per docs/01-design.md §5.6. `policy` and `background` are exactly
 * the two optional fields the design specifies; `debug` is this package's
 * own additive extension (brief, "Behaviour" §9 — exposes
 * `window.__cuep3dMetrics` for the bench to read), not a breaking change
 * to the frozen shape.
 */
export interface ViewerOptions {
  src: string;
  policy?: Partial<QualityPolicyOptions> | undefined;
  background?: string | undefined;
  debug?: boolean | undefined;
}

export interface Viewer extends EventTarget {
  readonly state: ViewerState;
  readonly degraded: boolean;
  readonly metrics: ViewerMetrics;
  dispose(): void;
}

export interface StateChangeEventDetail {
  state: ViewerState;
}

export type MetricsEventDetail = ViewerMetrics;

export interface ErrorEventDetail {
  error: Error;
}
