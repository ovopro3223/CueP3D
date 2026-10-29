import { createViewer } from './create-viewer.js';
import type { Viewer } from './types.js';

const TAG_NAME = 'understudy-viewer';

/**
 * `<understudy-viewer src="…" background="#fff"></understudy-viewer>` —
 * the thin wrapper around `createViewer` (§5.6). Options beyond `src`/
 * `background` (policy overrides, `debug`) are not expressible as HTML
 * attributes and stay the JS API's job; the element is a convenience for
 * the common case, not a full re-exposure of `createViewer`'s options.
 */
export class UnderstudyViewerElement extends HTMLElement {
  private viewer: Viewer | null = null;

  static get observedAttributes(): string[] {
    return ['src'];
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

  private mount(): void {
    const src = this.getAttribute('src');
    if (!src) return;
    const background = this.getAttribute('background') ?? undefined;
    this.viewer = createViewer(this, { src, background });
  }

  private unmount(): void {
    this.viewer?.dispose();
    this.viewer = null;
  }
}

export function defineUnderstudyViewerElement(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(TAG_NAME)) return;
  customElements.define(TAG_NAME, UnderstudyViewerElement);
}
