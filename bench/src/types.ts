import type { NetworkPreset } from './presets.js';
import type { BenchMode, BenchModel } from './models.js';
import type { CaseResult } from './metrics-snapshot.js';

export interface SweepCell {
  readonly presetId: NetworkPreset['id'];
  readonly modelSlug: BenchModel['slug'];
  readonly mode: BenchMode;
  readonly runs: readonly CaseResult[];
  readonly medianResult: CaseResult;
}

export interface SweepReport {
  readonly commitHash: string;
  readonly chromiumVersion: string;
  readonly dateIso: string;
  readonly presets: readonly NetworkPreset[];
  readonly models: readonly BenchModel[];
  readonly cells: readonly SweepCell[];
}
