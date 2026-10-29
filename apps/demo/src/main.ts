import { resolvePolicyOverrides } from './device-policy.js';
import { findModel, modelBaseUrl } from './models.js';
import { mountPlainPane, type PlainPaneHandle } from './plain-pane.js';
import { mountUnderstudyPane, type UnderstudyPaneHandle } from './understudy-pane.js';

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

const plainPane: PlainPaneHandle = mountPlainPane({
  container: plainViewport,
  metricsEl: plainMetrics,
  baseUrl: modelBaseUrl(findModel(picker.value)),
  reducedMotion,
});

let understudyPane: UnderstudyPaneHandle | null = null;
void mountUnderstudyPane({
  container: understudyViewport,
  metricsEl: understudyMetrics,
  baseUrl: modelBaseUrl(findModel(picker.value)),
  background: PROXY_BACKGROUND,
  policyOverrides: resolvePolicyOverrides(lowEndToggle.checked),
  reducedMotion,
}).then((handle) => {
  understudyPane = handle;
});

updateAttribution(picker.value);

picker.addEventListener('change', () => {
  const model = findModel(picker.value);
  const baseUrl = modelBaseUrl(model);
  plainPane.setModel(baseUrl);
  understudyPane?.setModel(baseUrl);
  updateAttribution(model.slug);
});

reloadButton.addEventListener('click', () => {
  plainPane.reload();
  understudyPane?.reload();
});

lowEndToggle.addEventListener('change', () => {
  understudyPane?.setPolicyOverrides(resolvePolicyOverrides(lowEndToggle.checked));
});
