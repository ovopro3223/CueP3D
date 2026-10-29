import type { Viewer } from '@cuep3d/viewer';
import { formatBytes, formatMs, renderMetricsStrip } from './metrics.js';
import type { BenchMetricsSnapshot } from './bench-hook.js';

/**
 * `packages/viewer` is real now (landed and merged — see docs/reports/
 * P6-report.md). This file is coded against the frozen docs/01-design.md
 * §5.6 API; the dynamic import below stays wrapped in try/catch so the pane
 * degrades gracefully if the package is ever missing or throws on load,
 * rather than taking down the whole page.
 */

export interface CueP3DPaneOptions {
  readonly container: HTMLElement;
  readonly metricsEl: HTMLDListElement;
  readonly baseUrl: string;
  readonly background: string;
  readonly policyOverrides: object | null;
  readonly reducedMotion: boolean;
  readonly onUpdate?: ((state: string, metrics: BenchMetricsSnapshot) => void) | undefined;
}

export interface CueP3DPaneHandle {
  setModel(baseUrl: string): void;
  setPolicyOverrides(overrides: object | null): void;
  reload(): void;
  dispose(): void;
}

// The custom element is assumed to implement the Viewer interface directly
// (§5.6: "<cuep3d-viewer> wraps createViewer"). `policy` as a settable
// JS property (rather than an attribute) is this file's own assumption
// bridging a gap the frozen API leaves open for the element form — see the
// open question in docs/reports/P7a-report.md.
type CueP3DViewerElement = HTMLElement &
  Viewer & {
    policy?: object | undefined;
  };

function noopHandle(): CueP3DPaneHandle {
  return {
    setModel(): void {},
    setPolicyOverrides(): void {},
    reload(): void {},
    dispose(): void {},
  };
}

export async function mountCueP3DPane(options: CueP3DPaneOptions): Promise<CueP3DPaneHandle> {
  const { container, metricsEl, background, reducedMotion, onUpdate } = options;
  let baseUrl = options.baseUrl;
  let policyOverrides = options.policyOverrides;
  let disposed = false;

  function showBlocked(detail: string): void {
    container.replaceChildren();
    const note = document.createElement('div');
    note.className = 'viewport-note';
    note.dataset.tone = 'error';
    note.textContent = `Blocked on packages/viewer (not available in this worktree): ${detail}`;
    container.appendChild(note);
    renderMetricsStrip(metricsEl, { label: 'State', value: 'blocked' }, [
      { label: 'Time to live 3D', value: '—' },
      { label: 'Time to settled', value: '—' },
      { label: 'Bytes before first visual', value: '—' },
      { label: 'Bytes total', value: '—' },
    ]);
    onUpdate?.('blocked', { bytesBeforeFirstVisual: 0, bytesTotal: 0 });
  }

  try {
    // A literal specifier (not @vite-ignore'd) so Vite resolves and bundles
    // it normally, both in dev and in the production build — the same way
    // any other real dependency is imported.
    await import('@cuep3d/viewer');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showBlocked(message);
    return noopHandle();
  }

  const el = document.createElement('cuep3d-viewer') as CueP3DViewerElement;
  el.setAttribute('aria-label', 'CueP3D pane 3D view');

  function renderMetricsFromViewer(): void {
    renderMetricsStrip(metricsEl, { label: 'State', value: el.state }, [
      { label: 'TTFV', value: formatMs(el.metrics.ttfv) },
      { label: 'First video frame', value: formatMs(el.metrics.ttProxyFrame) },
      { label: 'TTI', value: formatMs(el.metrics.tti) },
      { label: 'Time to live 3D', value: formatMs(el.metrics.ttLive) },
      { label: 'Time to settled', value: formatMs(el.metrics.ttSettled) },
      { label: 'Bytes before first visual', value: formatBytes(el.metrics.bytesBeforeFirstVisual) },
      { label: 'Bytes total', value: formatBytes(el.metrics.bytesTotal) },
    ]);
    onUpdate?.(el.state, {
      ttfv: el.metrics.ttfv,
      ttProxyFrame: el.metrics.ttProxyFrame,
      tti: el.metrics.tti,
      ttLive: el.metrics.ttLive,
      ttSettled: el.metrics.ttSettled,
      bytesBeforeFirstVisual: el.metrics.bytesBeforeFirstVisual,
      bytesTotal: el.metrics.bytesTotal,
    });
  }

  el.addEventListener('statechange', renderMetricsFromViewer);
  el.addEventListener('metrics', renderMetricsFromViewer);
  el.addEventListener('error', (event: Event) => {
    const detail = (event as CustomEvent<{ error?: unknown }>).detail?.error;
    showBlocked(detail instanceof Error ? detail.message : String(detail));
  });

  function mount(forceReload: boolean): void {
    container.replaceChildren(el);
    const src = forceReload
      ? `${baseUrl}cuep3d.json?t=${String(Date.now())}`
      : `${baseUrl}cuep3d.json`;
    el.policy = { ...policyOverrides, reducedMotion };
    el.setAttribute('background', background);
    el.setAttribute('src', src);
    renderMetricsFromViewer();
  }

  mount(false);

  return {
    setModel(newBaseUrl: string): void {
      baseUrl = newBaseUrl;
      mount(false);
    },
    setPolicyOverrides(overrides: object | null): void {
      policyOverrides = overrides;
      mount(false);
    },
    reload(): void {
      mount(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      el.dispose();
      container.replaceChildren();
    },
  };
}
