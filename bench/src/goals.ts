import type { SweepReport } from './types.js';

/** docs/01-design.md §3: the project's own stated performance goals. */
export const TTFV_GOAL_MS = 500;
export const TTI_GOAL_MS = 3000;
const GOAL_PRESET_ID = '3g-fast';
const GOAL_MODE = 'cuep3d';

export interface GoalViolation {
  readonly modelSlug: string;
  readonly metric: 'ttfv' | 'tti';
  readonly valueMs: number;
  readonly limitMs: number;
}

export function checkGoals(report: SweepReport): GoalViolation[] {
  const violations: GoalViolation[] = [];
  for (const cell of report.cells) {
    if (cell.presetId !== GOAL_PRESET_ID || cell.mode !== GOAL_MODE) continue;
    const { ttfv, tti } = cell.medianResult.metrics;
    if (ttfv !== undefined && ttfv > TTFV_GOAL_MS) {
      violations.push({
        modelSlug: cell.modelSlug,
        metric: 'ttfv',
        valueMs: ttfv,
        limitMs: TTFV_GOAL_MS,
      });
    }
    if (tti !== undefined && tti > TTI_GOAL_MS) {
      violations.push({
        modelSlug: cell.modelSlug,
        metric: 'tti',
        valueMs: tti,
        limitMs: TTI_GOAL_MS,
      });
    }
  }
  return violations;
}
