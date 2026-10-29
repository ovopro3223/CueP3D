import { resolvePolicyOverrides } from './device-policy.js';
import { findModel, modelBaseUrl, DEMO_MODELS } from './models.js';
import type { PlainPaneHandle } from './plain-pane.js';
import { mountCueP3DPane, type CueP3DPaneHandle } from './cuep3d-pane.js';
import { exposeBenchState } from './bench-hook.js';

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`main: missing element ${selector}`);
  return el;
}

const picker = requireEl<HTMLSelectElement>('#model-picker');
const reloadButton = requireEl<HTMLButtonElement>('#reload-both');
const lowEndToggle = requireEl<HTMLInputElement>('#low-end-toggle');
const attributionEl = requireEl<HTMLParagraphElement>('#model-attribution');
const plainViewport = requireEl<HTMLDivElement>('#plain-viewport');
const plainMetrics = requireEl<HTMLDListElement>('#plain-metrics');
const cuep3dViewport = requireEl<HTMLDivElement>('#cuep3d-viewport');
const cuep3dMetrics = requireEl<HTMLDListElement>('#cuep3d-metrics');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `bench/` loads this page as `/?model=…&mode=plain|cuep3d&debug=1`
 * (docs/briefs/P7-demo-and-bench.md Part B). `mode` is bench-only: a human
 * visitor never sets it and gets the original both-panes layout. `debug`
 * mirrors each pane's state/metrics onto `window.__cuep3dMetrics` /
 * `window.__cuep3dState` (see bench-hook.ts) so the harness can read
 * them without scraping the metrics-strip DOM text.
 */
const params = new URLSearchParams(window.location.search);
const modeParam = params.get('mode');
const modelParam = params.get('model');
const debugMode = params.get('debug') === '1';
const showPlain = modeParam !== 'cuep3d';
const showCueP3D = modeParam !== 'plain';

if (modelParam && DEMO_MODELS.some((m) => m.slug === modelParam)) {
  picker.value = modelParam;
}

// All three demo models are built with the CLI's default --background
// (see docs/01-design.md §5.2 ProxyVariant.background, always "#ffffff" for
// these samples) — kept as a constant here rather than re-fetching the
// manifest a second time just for this one field.
const PROXY_BACKGROUND = '#ffffff';

function updateAttribution(slug: string): void {
  const model = findModel(slug);
  attributionEl.replaceChildren();
  const link = document.createElement('a');
  link.href = model.attributionUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = model.attribution;
  attributionEl.append(link);
}

// Both panes are dynamic imports (D-014): this entry module stays a few KB,
// so neither pane's code — three.js and GLTFLoader for Plain, three.js,
// mp4box and the viewer for CueP3D — is downloaded before the page knows
// which pane(s) it is showing. `?mode=plain` never fetches CueP3D's code
// and `?mode=cuep3d` never fetches the Plain pane's, which keeps the
// bench's two columns independent of each other's bundle weight.
let plainPane: PlainPaneHandle | null = null;
if (showPlain) {
  void import('./plain-pane.js').then(({ mountPlainPane }) => {
    plainPane = mountPlainPane({
      container: plainViewport,
      metricsEl: plainMetrics,
      baseUrl: modelBaseUrl(findModel(picker.value)),
      reducedMotion,
      ...(debugMode ? { onUpdate: (state, metrics) => exposeBenchState(state, metrics) } : {}),
    });
  });
}

let cuep3dPane: CueP3DPaneHandle | null = null;
if (showCueP3D) {
  void mountCueP3DPane({
    container: cuep3dViewport,
    metricsEl: cuep3dMetrics,
    baseUrl: modelBaseUrl(findModel(picker.value)),
    background: PROXY_BACKGROUND,
    policyOverrides: resolvePolicyOverrides(lowEndToggle.checked),
    reducedMotion,
    ...(debugMode ? { onUpdate: (state, metrics) => exposeBenchState(state, metrics) } : {}),
  }).then((handle) => {
    cuep3dPane = handle;
  });
}

updateAttribution(picker.value);

picker.addEventListener('change', () => {
  const model = findModel(picker.value);
  const baseUrl = modelBaseUrl(model);
  plainPane?.setModel(baseUrl);
  cuep3dPane?.setModel(baseUrl);
  updateAttribution(model.slug);
});

reloadButton.addEventListener('click', () => {
  plainPane?.reload();
  cuep3dPane?.reload();
});

lowEndToggle.addEventListener('change', () => {
  cuep3dPane?.setPolicyOverrides(resolvePolicyOverrides(lowEndToggle.checked));
});
