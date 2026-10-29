/**
 * Deliberately NOT typed against @understudy3d/viewer's QualityPolicyOptions
 * (packages/viewer doesn't exist in this worktree yet — see P7a report). This
 * stays a plain, local shape so apps/demo's own typecheck/lint/test stay
 * green regardless of that package's build status. understudy-pane.ts casts
 * this into the real option when it wires the element.
 */
export interface LowEndPolicyOverrides {
  readonly deviceTier: 'low';
  readonly maxTier: 'L1';
  readonly proxyPreferWidth: 512;
  readonly frameCacheBudget: 12;
}

export const LOW_END_POLICY_OVERRIDES: LowEndPolicyOverrides = {
  deviceTier: 'low',
  maxTier: 'L1',
  proxyPreferWidth: 512,
  frameCacheBudget: 12,
};

export function resolvePolicyOverrides(simulateLowEnd: boolean): LowEndPolicyOverrides | null {
  return simulateLowEnd ? LOW_END_POLICY_OVERRIDES : null;
}
