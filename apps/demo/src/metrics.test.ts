import { describe, expect, it } from 'vitest';
import { formatBytes, formatMs, renderMetricsStrip } from './metrics.js';

describe('formatMs', () => {
  it('rounds to the nearest millisecond', () => {
    expect(formatMs(123.6)).toBe('124 ms');
  });

  it('renders an em dash for unknown values', () => {
    expect(formatMs(undefined)).toBe('—');
    expect(formatMs(Number.NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('uses bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('uses KB under 1 MB', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('uses MB at and above 1 MB', () => {
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.50 MB');
  });

  it('renders an em dash for unknown values', () => {
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('renderMetricsStrip', () => {
  it('renders the state row and each metric row as dt/dd pairs', () => {
    const dl = document.createElement('dl');
    renderMetricsStrip(dl, { label: 'State', value: 'live' }, [
      { label: 'Bytes total', value: '1.2 MB' },
    ]);

    const labels = Array.from(dl.querySelectorAll('dt')).map((el) => el.textContent);
    const values = Array.from(dl.querySelectorAll('dd')).map((el) => el.textContent);
    expect(labels).toEqual(['State', 'Bytes total']);
    expect(values).toEqual(['live', '1.2 MB']);

    const stateDd = dl.querySelector('dd.state-value');
    expect(stateDd?.getAttribute('data-state')).toBe('live');
  });

  it('clears previous rows on re-render', () => {
    const dl = document.createElement('dl');
    renderMetricsStrip(dl, { label: 'State', value: 'idle' }, [{ label: 'A', value: '1' }]);
    renderMetricsStrip(dl, { label: 'State', value: 'live' }, []);
    expect(dl.querySelectorAll('dt').length).toBe(1);
  });
});
