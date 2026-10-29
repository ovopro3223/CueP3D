import { describe, expect, it } from 'vitest';
import { createMetricsTracker } from './metrics.js';

describe('createMetricsTracker', () => {
  it('keeps the first TTFV mark and its byte count when a later caller marks again (poster, then video frame)', () => {
    const tracker = createMetricsTracker(performance.now());
    tracker.markTtfv(4_000);
    const first = tracker.snapshot();
    tracker.markTtfv(40_000);
    const second = tracker.snapshot();
    expect(second.ttfv).toBe(first.ttfv);
    expect(second.bytesBeforeFirstVisual).toBe(4_000);
  });

  it('records the first decoded video frame separately from the first visual', () => {
    const tracker = createMetricsTracker(performance.now());
    expect(tracker.snapshot().ttProxyFrame).toBeUndefined();
    tracker.markTtProxyFrame();
    const once = tracker.snapshot().ttProxyFrame;
    expect(once).toBeGreaterThanOrEqual(0);
    tracker.markTtProxyFrame();
    expect(tracker.snapshot().ttProxyFrame).toBe(once);
  });

  it('leaves bytesBeforeFirstVisual alone when ttLive is marked without a byte count', () => {
    const tracker = createMetricsTracker(performance.now());
    tracker.markTtfv(1_234);
    tracker.markTtLive();
    expect(tracker.snapshot().bytesBeforeFirstVisual).toBe(1_234);
    tracker.markTtLive(99);
    expect(tracker.snapshot().bytesBeforeFirstVisual).toBe(99);
  });
});
