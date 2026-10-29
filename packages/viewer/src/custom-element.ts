import { createViewer } from './create-viewer.js';
import type { Viewer, ViewerMetrics, ViewerState } from './types.js';

const TAG_NAME = 'cuep3d-viewer';

const IDLE_METRICS: ViewerMetrics = { bytesBeforeFirstVisual: 0, bytesTotal: 0 };

const FORWARDED_EVENTS = ['statechange', 'metrics', 'error'] as const;

/**
 * `<cuep3d-viewer src="…" background="#fff"></cuep3d-viewer>` —
 * wraps `createViewer` (§5.6: "the element is assumed to implement the
 * Viewer interface directly"). `state`/`degraded`/`metrics` delegate to the
 * internal `createViewer()` instance, and its events are re-dispatched on
 * this element — `createViewer`'s `ViewerImpl` dispatches on itself (a
 * separate `EventTarget`), not on the container element it renders into, so
 * without this forwarding a consumer's `el.addEventListener('statechange',
 * …)` would never fire and `el.metrics`/`el.state` would always read as
 * whatever the pre-mount default is.
 */
export class CueP3DViewerElement extends HTMLElement implements Viewer {
  private viewerImpl: Viewer | null = null;

  static get observedAttributes(): string[] {
    return ['src'];
  }

  get state(): ViewerState {
    return this.viewerImpl?.state ?? 'idle';
  }

  get degraded(): boolean {
    return this.viewerImpl?.degraded ?? false;
  }

  get metrics(): ViewerMetrics {
    return this.viewerImpl?.metrics ?? IDLE_METRICS;
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.unmount();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'src' && this.isConnected) {
      this.unmount();
      this.mount();
    }
  }

  dispose(): void {
    this.unmount();
  }

  private mount(): void {
    const src = this.getAttribute('src');
    if (!src) return;
    const background = this.getAttribute('background') ?? undefined;
    const viewer = createViewer(this, { src, background });
    this.viewerImpl = viewer;
    for (const type of FORWARDED_EVENTS) {
      viewer.addEventListener(type, (event) => {
        if (this.viewerImpl !== viewer) return; // stale listener from a since-unmounted instance
        const detail = (event as CustomEvent).detail as unknown;
        this.dispatchEvent(new CustomEvent(type, { detail }));
      });
    }
  }

  private unmount(): void {
    this.viewerImpl?.dispose();
    this.viewerImpl = null;
  }
}

export function defineCueP3DViewerElement(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(TAG_NAME)) return;
  customElements.define(TAG_NAME, CueP3DViewerElement);
}
