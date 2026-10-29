/**
 * Minimal ambient typing for the `window` global referenced inside
 * `page.evaluate(...)` callback bodies below. This package's tsconfig has no
 * "DOM" lib (it's a Node package), so these callbacks — which only ever run
 * inside headless Chromium, never under Node — need just enough of a
 * declaration to type-check without pulling in all of lib.dom (which would
 * collide with @types/node's own `fetch`/`Headers`/`Response`).
 */
export {};

declare global {
  interface Window {
    __understudyRender?: {
      load(url: string): Promise<void>;
      setView(azimuthRad: number, elevationRad: number): void;
      snapshot(): Promise<string>;
    };
    __understudyPageReady?: boolean;
    __understudyPageError?: string;
  }

  var window: Window & typeof globalThis;
}
