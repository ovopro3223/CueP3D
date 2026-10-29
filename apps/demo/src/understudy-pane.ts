import type { Viewer } from '@understudy3d/viewer';
import { formatBytes, formatMs, renderMetricsStrip } from './metrics.js';

/**
 * packages/viewer does not exist in this worktree yet (a separate agent owns
 * it in its own worktree — see docs/reports/P7a-report.md). This file is
 * coded exactly against the frozen docs/01-design.md §5.6 API so wiring it
 * up is a no-op once that package lands and `pnpm install` can resolve it.
 * Until then:
 *   - the `import type` above is erased by Vite/esbuild at build time (no
 *     runtime resolution needed for it), but tsc still resolves it at
 *     typecheck time and fails with TS2307 — expected, documented, not
 *     worked around with a fake shim.
 *   - the actual runtime `import('@understudy3d/viewer')` below is a
 *     genuine dynamic import, wrapped in try/catch so a missing package
 *     degrades this one pane instead of taking down the whole page (the
 *     Plain pane's module graph is untouched by this failure).
 */

export interface UnderstudyPaneOptions {
  readonly container: HTMLElement;
  readonly metricsEl: HTMLDListElement;
  readonly baseUrl: string;
  readonly background: string;
  readonly policyOverrides: object | null;
  readonly reducedMotion: boolean;
}

export interface UnderstudyPaneHandle {
  setModel(baseUrl: string): void;
  setPolicyOverrides(overrides: object | null): void;
  reload(): void;
  dispose(): void;
}

// The custom element is assumed to implement the Viewer interface directly
// (§5.6: "<understudy-viewer> wraps createViewer"). `policy` as a settable
// JS property (rather than an attribute) is this file's own assumption
// bridging a gap the frozen API leaves open for the element form — see the
// open question in docs/reports/P7a-report.md.
type UnderstudyViewerElement = HTMLElement &
  Viewer & {
    policy?: object | undefined;
  };

function noopHandle(): UnderstudyPaneHandle {
  return {
    setModel(): void {},
    setPolicyOverrides(): void {},
    reload(): void {},
    dispose(): void {},
  };
}

export async function mountUnderstudyPane(
  options: UnderstudyPaneOptions,
): Promise<UnderstudyPaneHandle> {
  const { container, metricsEl, background, reducedMotion } = options;
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
  }

  try {
    // Non-literal specifier + @vite-ignore: a literal `import('@understudy3d/viewer')`
    // makes Vite's import-analysis plugin eagerly resolve-check it even
    // inside try/catch, which errors the whole dev session instead of just
    // this pane. See docs/reports/P7a-report.md.
    const viewerSpecifier = '@understudy3d/viewer';
    await import(/* @vite-ignore */ viewerSpecifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showBlocked(message);
    return noopHandle();
  }

  const el = document.createElement('understudy-viewer') as UnderstudyViewerElement;
  el.setAttribute('aria-label', 'Understudy pane 3D view');

  function renderMetricsFromViewer(): void {
    renderMetricsStrip(metricsEl, { label: 'State', value: el.state }, [
      { label: 'TTFV', value: formatMs(el.metrics.ttfv) },
      { label: 'TTI', value: formatMs(el.metrics.tti) },
      { label: 'Time to live 3D', value: formatMs(el.metrics.ttLive) },
      { label: 'Time to settled', value: formatMs(el.metrics.ttSettled) },
      { label: 'Bytes before first visual', value: formatBytes(el.metrics.bytesBeforeFirstVisual) },
      { label: 'Bytes total', value: formatBytes(el.metrics.bytesTotal) },
    ]);
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
      ? `${baseUrl}understudy.json?t=${String(Date.now())}`
      : `${baseUrl}understudy.json`;
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
