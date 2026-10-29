export interface MetricRow {
  readonly label: string;
  readonly value: string;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function renderMetricsStrip(
  el: HTMLDListElement,
  state: { label: string; value: string },
  rows: readonly MetricRow[],
): void {
  el.replaceChildren();
  const fragment = document.createDocumentFragment();

  const stateDt = document.createElement('dt');
  stateDt.textContent = state.label;
  const stateDd = document.createElement('dd');
  stateDd.textContent = state.value;
  stateDd.classList.add('state-value');
  stateDd.dataset.state = state.value.toLowerCase().replace(/\s+/g, '-');
  fragment.append(stateDt, stateDd);

  for (const row of rows) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = row.value;
    fragment.append(dt, dd);
  }

  el.append(fragment);
}
