import { describe, expect, it } from 'vitest';
import { LOW_END_POLICY_OVERRIDES, resolvePolicyOverrides } from './device-policy.js';

describe('resolvePolicyOverrides', () => {
  it('returns null when the low-end toggle is off', () => {
    expect(resolvePolicyOverrides(false)).toBeNull();
  });

  it('returns the shared low-end overrides object when the toggle is on', () => {
    expect(resolvePolicyOverrides(true)).toBe(LOW_END_POLICY_OVERRIDES);
  });

  it('caps the simulated tier at L1 and the proxy at 512px', () => {
    const overrides = resolvePolicyOverrides(true);
    expect(overrides?.maxTier).toBe('L1');
    expect(overrides?.proxyPreferWidth).toBe(512);
  });
});
