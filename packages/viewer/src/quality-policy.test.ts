import { describe, expect, it } from 'vitest';
import type { ProxyVariant } from '@cuep3d/manifest';
import {
  chooseQuality,
  classifyDeviceTier,
  desiredProxyWidth,
  orderVariantsByPreferredWidth,
  type QualityPolicyOptions,
} from './quality-policy.js';

function variant(kind: ProxyVariant['codec'], width: number): ProxyVariant {
  const base = { width, height: width, bytes: 100_000, frames: 72 };
  if (kind === 'avif') {
    return {
      kind: 'image-sequence',
      codec: 'avif',
      url: `frames-${width}/{i}.avif`,
      ...base,
    } as ProxyVariant;
  }
  return {
    kind: 'video',
    codec: kind,
    container: 'mp4',
    gop: 8,
    url: `proxy-${width}.${kind}.mp4`,
    ...base,
  } as ProxyVariant;
}

// Mirrors build-encode's real push order: AV1 at every size (largest
// first), then VP9 and AVIF at the smallest size only (§7 step 3).
const AV1_1024 = variant('av01', 1024);
const AV1_512 = variant('av01', 512);
const VP9_512 = variant('vp09', 512);
const AVIF_512 = variant('avif', 512);
const ALL_VARIANTS = [AV1_1024, AV1_512, VP9_512, AVIF_512];

const ALL_TIERS = ['L0', 'L1', 'L2'] as const;

function opts(partial: Partial<QualityPolicyOptions>): QualityPolicyOptions {
  return { canvasCssWidth: 800, dpr: 1, ...partial };
}

describe('chooseQuality (table-driven)', () => {
  it('slow 3G phone: low-end specs + 3G → 512 proxy already selected, maxTier L1, serial, small cache', () => {
    const decision = chooseQuality({
      options: opts({
        canvasCssWidth: 320,
        dpr: 2,
        connection: { effectiveType: '3g', downlink: 0.7 },
        deviceMemory: 1,
        hardwareConcurrency: 2,
      }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('low');
    expect(decision.proxyVariant).toBe(AV1_512);
    expect(decision.maxTier).toBe('L1');
    expect(decision.downloadMode).toBe('serial');
    expect(decision.cacheBudget).toBe(12);
  });

  it('desktop wifi: high-end specs + fast link → 1024 proxy, L2, parallel, large cache', () => {
    const decision = chooseQuality({
      options: opts({
        canvasCssWidth: 1200,
        dpr: 2,
        connection: { effectiveType: '4g', downlink: 50 },
        deviceMemory: 16,
        hardwareConcurrency: 12,
        rendererString: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      }),
      selectedVariant: AV1_1024,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('high');
    expect(decision.proxyVariant).toBe(AV1_1024);
    expect(decision.maxTier).toBe('L2');
    expect(decision.downloadMode).toBe('parallel');
    expect(decision.cacheBudget).toBe(48);
  });

  it('saveData forces serial and caps at L1 even on an otherwise capable device', () => {
    const decision = chooseQuality({
      options: opts({
        canvasCssWidth: 1200,
        dpr: 2,
        connection: { effectiveType: '4g', saveData: true },
        deviceMemory: 16,
        hardwareConcurrency: 12,
      }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.downloadMode).toBe('serial');
    expect(decision.maxTier).toBe('L1');
  });

  it('no proxy support → proxyVariant is null regardless of every other signal', () => {
    const decision = chooseQuality({
      options: opts({ deviceMemory: 16, hardwareConcurrency: 12 }),
      selectedVariant: null,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.proxyVariant).toBeNull();
  });

  it('prefersReducedData combined with a small physical canvas tips an otherwise-mid device to low', () => {
    const decision = chooseQuality({
      options: opts({ canvasCssWidth: 300, dpr: 1, prefersReducedData: true }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('low');
    expect(decision.maxTier).toBe('L1');
  });

  it('3G alone forces serial downloads even at a mid device tier (L2 still allowed)', () => {
    const decision = chooseQuality({
      options: opts({
        canvasCssWidth: 800,
        dpr: 1,
        connection: { effectiveType: '3g' },
        deviceMemory: 4,
        hardwareConcurrency: 4,
      }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('mid');
    expect(decision.downloadMode).toBe('serial');
    expect(decision.maxTier).toBe('L2');
  });

  it("the project's own 3g-fast preset (1.6 Mbps; Chromium reports '4g', downlink 1.55) is a slow link → serial", () => {
    const decision = chooseQuality({
      options: {
        canvasCssWidth: 530,
        dpr: 1,
        connection: { effectiveType: '4g', downlink: 1.55 },
        hardwareConcurrency: 24,
      },
      selectedVariant: null,
      availableTierIds: ['L0', 'L1', 'L2'],
    });
    expect(decision.downloadMode).toBe('serial');
  });

  it('low measured downlink forces serial even with no effectiveType (Safari-style) on a high-end device', () => {
    const decision = chooseQuality({
      options: opts({
        canvasCssWidth: 1200,
        dpr: 2,
        connection: { downlink: 1.0 },
        deviceMemory: 16,
        hardwareConcurrency: 12,
      }),
      selectedVariant: AV1_1024,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('high');
    expect(decision.downloadMode).toBe('serial');
  });

  it('a known-weak GPU string alone does not override otherwise strongly-high signals (sums, not a hard veto)', () => {
    const decision = chooseQuality({
      options: opts({
        connection: { effectiveType: '4g' },
        deviceMemory: 16,
        hardwareConcurrency: 12,
        rendererString: 'SwiftShader',
      }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('mid');
    expect(decision.downloadMode).toBe('parallel');
    expect(decision.maxTier).toBe('L2');
  });

  it('a known-weak GPU string with no other signal is enough on its own to classify low', () => {
    const decision = chooseQuality({
      options: opts({ rendererString: 'Google SwiftShader' }),
      selectedVariant: AV1_512,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('low');
    expect(decision.maxTier).toBe('L1');
    expect(decision.downloadMode).toBe('serial');
  });

  it('caps maxTier to the highest tier the manifest actually has, even on a high-end device', () => {
    const decision = chooseQuality({
      options: opts({
        deviceMemory: 16,
        hardwareConcurrency: 12,
        connection: { effectiveType: '4g' },
      }),
      selectedVariant: AV1_1024,
      availableTierIds: ['L0'],
    });
    expect(decision.deviceTier).toBe('high');
    expect(decision.maxTier).toBe('L0');
  });

  it('caps maxTier to the highest tier available when only L0+L1 exist', () => {
    const decision = chooseQuality({
      options: opts({
        deviceMemory: 16,
        hardwareConcurrency: 12,
        connection: { effectiveType: '4g' },
      }),
      selectedVariant: AV1_1024,
      availableTierIds: ['L0', 'L1'],
    });
    expect(decision.maxTier).toBe('L1');
  });

  it('a plain mid-range device with no signals defaults to mid: L2, parallel, 24-frame cache', () => {
    const decision = chooseQuality({
      options: opts({}),
      selectedVariant: AV1_1024,
      availableTierIds: ALL_TIERS,
    });
    expect(decision.deviceTier).toBe('mid');
    expect(decision.maxTier).toBe('L2');
    expect(decision.downloadMode).toBe('parallel');
    expect(decision.cacheBudget).toBe(24);
  });
});

describe('desiredProxyWidth', () => {
  it('512 at exactly the 700px breakpoint (inclusive)', () => {
    expect(desiredProxyWidth(700, 1, 'mid')).toBe(512);
  });

  it('1024 just above the breakpoint', () => {
    expect(desiredProxyWidth(701, 1, 'mid')).toBe(1024);
  });

  it('a low device tier always gets 512, even on a huge canvas', () => {
    expect(desiredProxyWidth(4000, 2, 'low')).toBe(512);
  });

  it('DPR scales the effective width', () => {
    expect(desiredProxyWidth(400, 1, 'high')).toBe(512); // 400px
    expect(desiredProxyWidth(400, 2, 'high')).toBe(1024); // 800px
  });
});

describe('orderVariantsByPreferredWidth', () => {
  it('moves matching-width variants first, preserving relative order within each bucket', () => {
    expect(orderVariantsByPreferredWidth(ALL_VARIANTS, 512)).toEqual([
      AV1_512,
      VP9_512,
      AVIF_512,
      AV1_1024,
    ]);
  });

  it('a desired width with no matches returns the original order', () => {
    expect(orderVariantsByPreferredWidth(ALL_VARIANTS, 2048)).toEqual(ALL_VARIANTS);
  });

  it('leaves manifest order unchanged when everything already matches', () => {
    expect(orderVariantsByPreferredWidth([AV1_1024], 1024)).toEqual([AV1_1024]);
  });
});

describe('classifyDeviceTier boundaries', () => {
  it('score of exactly -3 is low, -2 is mid', () => {
    expect(classifyDeviceTier(opts({ rendererString: 'SwiftShader' }))).toBe('low'); // -3
    expect(classifyDeviceTier(opts({ deviceMemory: 1 }))).toBe('mid'); // -2
  });

  it('score of exactly 3 is high, 2 is mid', () => {
    expect(
      classifyDeviceTier(opts({ deviceMemory: 16, connection: { effectiveType: '4g' } })),
    ).toBe('high'); // +2+1 = +3
    expect(classifyDeviceTier(opts({ deviceMemory: 16 }))).toBe('mid'); // +2
  });
});
