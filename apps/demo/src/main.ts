import { resolvePolicyOverrides } from './device-policy.js';
import { findModel, modelBaseUrl, DEMO_MODELS } from './models.js';
import { mountPlainPane, type PlainPaneHandle } from './plain-pane.js';
import { mountUnderstudyPane, type UnderstudyPaneHandle } from './understudy-pane.js';
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
const understudyViewport = requireEl<HTMLDivElement>('#understudy-viewport');
const understudyMetrics = requireEl<HTMLDListElement>('#understudy-metrics');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `bench/` loads this page as `/?model=…&mode=plain|understudy&debug=1`
 * (docs/briefs/P7-demo-and-bench.md Part B). `mode` is bench-only: a human
 * visitor never sets it and gets the original both-panes layout. `debug`
 * mirrors each pane's state/metrics onto `window.__understudyMetrics` /
 * `window.__understudyState` (see bench-hook.ts) so the harness can read
 * them without scraping the metrics-strip DOM text.
 */
const params = new URLSearchParams(window.location.search);
const modeParam = params.get('mode');
const modelParam = params.get('model');
const debugMode = params.get('debug') === '1';
const showPlain = modeParam !== 'understudy';
const showUnderstudy = modeParam !== 'plain';

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

const plainPane: PlainPaneHandle | null = showPlain
  ? mountPlainPane({
      container: plainViewport,
      metricsEl: plainMetrics,
      baseUrl: modelBaseUrl(findModel(picker.value)),
      reducedMotion,
      ...(debugMode ? { onUpdate: (state, metrics) => exposeBenchState(state, metrics) } : {}),
    })
  : null;

let understudyPane: UnderstudyPaneHandle | null = null;
if (showUnderstudy) {
  void mountUnderstudyPane({
    container: understudyViewport,
    metricsEl: understudyMetrics,
    baseUrl: modelBaseUrl(findModel(picker.value)),
    background: PROXY_BACKGROUND,
    policyOverrides: resolvePolicyOverrides(lowEndToggle.checked),
    reducedMotion,
    ...(debugMode ? { onUpdate: (state, metrics) => exposeBenchState(state, metrics) } : {}),
  }).then((handle) => {
    understudyPane = handle;
  });
}

updateAttribution(picker.value);

picker.addEventListener('change', () => {
  const model = findModel(picker.value);
  const baseUrl = modelBaseUrl(model);
  plainPane?.setModel(baseUrl);
  understudyPane?.setModel(baseUrl);
  updateAttribution(model.slug);
});

reloadButton.addEventListener('click', () => {
  plainPane?.reload();
  understudyPane?.reload();
});

lowEndToggle.addEventListener('change', () => {
  understudyPane?.setPolicyOverrides(resolvePolicyOverrides(lowEndToggle.checked));
});
