import type { ProxyVariant, Tier } from '@understudy3d/manifest';

/**
 * QualityPolicy: a pure function from explicit, overridable inputs to a
 * download/quality decision (docs/01-design.md §6, brief "Behaviour" §2).
 * Nothing in this file touches `navigator`, `window`, or the network —
 * `device-signals.ts` gathers the real values; this module only decides
 * what to do with them, which is what makes it independently testable.
 */

export type TierId = Tier['id'];

export const TIER_ORDER: readonly TierId[] = ['L0', 'L1', 'L2'];

export type ConnectionEffectiveType = 'slow-2g' | '2g' | '3g' | '4g';

export interface ConnectionInfo {
  effectiveType?: ConnectionEffectiveType | undefined;
  downlink?: number | undefined;
  saveData?: boolean | undefined;
}

export interface QualityPolicyOptions {
  /** Canvas CSS width in px (before DPR). */
  canvasCssWidth: number;
  /** Device pixel ratio, already capped (viewer caps at 2 before this point). */
  dpr: number;
  connection?: ConnectionInfo | undefined;
  deviceMemory?: number | undefined;
  hardwareConcurrency?: number | undefined;
  /** `WEBGL_debug_renderer_info`'s UNMASKED_RENDERER_WEBGL string, if available. */
  rendererString?: string | undefined;
  prefersReducedData?: boolean | undefined;
}

export type DeviceTier = 'low' | 'mid' | 'high';

export type DownloadMode = 'serial' | 'parallel';

export interface QualityPolicyDecision {
  proxyVariant: ProxyVariant | null;
  maxTier: TierId;
  downloadMode: DownloadMode;
  /**
   * Frame-prefetch radius hint. NOT an LRU size: @understudy3d/proxy-player's
   * `createProxyPlayer(variant, baseUrl)` takes no cache-size option (frozen
   * §5.4 signature) — its internal LRU is a fixed default. This budget is
   * used by the viewer itself as the `radius` argument to `player.prefetch()`
   * on every pointer move, so a low-end device asks for less look-ahead
   * decode work per drag step. See docs/reports/P6-report.md.
   */
  cacheBudget: number;
  deviceTier: DeviceTier;
}

export const QUALITY_POLICY_THRESHOLDS = {
  /** navigator.deviceMemory, GiB. */
  lowDeviceMemoryGiB: 2,
  highDeviceMemoryGiB: 8,
  /** navigator.hardwareConcurrency. */
  lowCores: 2,
  highCores: 8,
  /** canvasCssWidth × dpr, px — design §6's exact breakpoint. */
  proxyWidthBreakpointPx: 700,
  /** canvasCssWidth × dpr below this nudges the device-tier score down
   * (small physical surface, soft "this might be a phone" signal — never
   * decisive alone). */
  smallPhysicalCanvasPx: 500,
  /** downlink in Mbit/s below which the link is treated as slow even if
   * `effectiveType` is unavailable (Safari does not expose it). */
  slowDownlinkMbps: 1.5,
  /** Score thresholds classifying into low/mid/high (see classifyDeviceTier). */
  lowScore: -3,
  highScore: 3,
  cacheBudgetLow: 12,
  cacheBudgetMid: 24,
  cacheBudgetHigh: 48,
} as const;

/**
 * Lower-cased substrings of UNMASKED_RENDERER_WEBGL known to be weak
 * (software rasterizers, and GPU families several generations behind
 * anything that ships today). Deliberately short and conservative: a false
 * "low" here costs visual quality for a user who could have handled more; a
 * false "high" costs a stutter. Erring toward not-flagging unknown strings.
 */
const LOW_END_GPU_SUBSTRINGS = [
  'swiftshader',
  'llvmpipe',
  'software',
  'mali-4',
  'mali-3',
  'mali-t6',
  'mali-t7',
  'powervr sgx',
  'adreno 2',
  'adreno 3',
  'adreno 4',
  'intel(r) hd graphics 2000',
  'intel(r) hd graphics 3000',
];

function isLowEndRenderer(rendererString: string | undefined): boolean {
  if (!rendererString) return false;
  const lower = rendererString.toLowerCase();
  return LOW_END_GPU_SUBSTRINGS.some((substring) => lower.includes(substring));
}

const EFFECTIVE_TYPE_SCORE: Record<ConnectionEffectiveType, number> = {
  'slow-2g': -3,
  '2g': -3,
  '3g': -1,
  '4g': 1,
};

/**
 * A signed score: negative pulls toward 'low', positive toward 'high'. Each
 * signal contributes independently (see QUALITY_POLICY_THRESHOLDS for the
 * exact numbers and docs/reports/P6-report.md for the "why" behind each one);
 * a strong single signal (a known-weak GPU, `saveData`) can outweigh several
 * weak ones, which a simple AND/OR tree could not express as cleanly.
 */
export function classifyDeviceTier(options: QualityPolicyOptions): DeviceTier {
  const t = QUALITY_POLICY_THRESHOLDS;
  let score = 0;

  if (options.deviceMemory !== undefined) {
    if (options.deviceMemory <= t.lowDeviceMemoryGiB) score -= 2;
    else if (options.deviceMemory >= t.highDeviceMemoryGiB) score += 2;
  }
  if (options.hardwareConcurrency !== undefined) {
    if (options.hardwareConcurrency <= t.lowCores) score -= 2;
    else if (options.hardwareConcurrency >= t.highCores) score += 2;
  }
  if (isLowEndRenderer(options.rendererString)) score -= 3;
  if (options.connection?.saveData) score -= 3;
  if (options.connection?.effectiveType) {
    score += EFFECTIVE_TYPE_SCORE[options.connection.effectiveType];
  }
  if (options.prefersReducedData) score -= 2;
  if (options.canvasCssWidth * options.dpr < t.smallPhysicalCanvasPx) score -= 1;

  if (score <= t.lowScore) return 'low';
  if (score >= t.highScore) return 'high';
  return 'mid';
}

/** 512 when canvasWidth·DPR ≤ 700 (§6), or unconditionally for a low-tier device. */
export function desiredProxyWidth(
  canvasCssWidth: number,
  dpr: number,
  deviceTier: DeviceTier,
): 512 | 1024 {
  if (deviceTier === 'low') return 512;
  return canvasCssWidth * dpr <= QUALITY_POLICY_THRESHOLDS.proxyWidthBreakpointPx ? 512 : 1024;
}

/**
 * Stable partition: variants whose width matches `desiredWidth` first (in
 * their original manifest order), then every other variant (also in
 * original order) as a fallback bucket. `selectProxyVariant` (frozen §5.4)
 * only probes codec capability in list order, so this is how width
 * preference is expressed without touching that frozen function.
 */
export function orderVariantsByPreferredWidth(
  variants: readonly ProxyVariant[],
  desiredWidth: number,
): ProxyVariant[] {
  const preferred: ProxyVariant[] = [];
  const rest: ProxyVariant[] = [];
  for (const variant of variants) {
    (variant.width === desiredWidth ? preferred : rest).push(variant);
  }
  return [...preferred, ...rest];
}

function isSlowConnection(options: QualityPolicyOptions): boolean {
  const connection = options.connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  if (connection.effectiveType && connection.effectiveType !== '4g') return true;
  if (
    connection.downlink !== undefined &&
    connection.downlink < QUALITY_POLICY_THRESHOLDS.slowDownlinkMbps
  ) {
    return true;
  }
  return false;
}

function maxTierForDeviceTier(deviceTier: DeviceTier, availableTierIds: readonly TierId[]): TierId {
  const highestAvailableIndex = Math.max(
    0,
    ...availableTierIds.map((id) => TIER_ORDER.indexOf(id)).filter((i) => i >= 0),
  );
  const cap = deviceTier === 'low' ? TIER_ORDER.indexOf('L1') : TIER_ORDER.indexOf('L2');
  return TIER_ORDER[Math.min(highestAvailableIndex, cap)]!;
}

export interface ChooseQualityInput {
  options: QualityPolicyOptions;
  /**
   * The result of `await selectProxyVariant(candidates)` where `candidates`
   * is `orderVariantsByPreferredWidth(manifest.proxy.variants, desiredWidth)`
   * — resolved by the caller (createViewer), not here, so this function
   * stays synchronous and pure. `null` means no variant this browser can
   * decode exists (degraded path).
   */
  selectedVariant: ProxyVariant | null;
  /** `manifest.tiers.map(t => t.id)`. */
  availableTierIds: readonly TierId[];
}

export function chooseQuality(input: ChooseQualityInput): QualityPolicyDecision {
  const { options, selectedVariant, availableTierIds } = input;
  const deviceTier = classifyDeviceTier(options);
  const t = QUALITY_POLICY_THRESHOLDS;

  let maxTier = maxTierForDeviceTier(deviceTier, availableTierIds);
  let downloadMode: DownloadMode =
    deviceTier === 'low' || isSlowConnection(options) ? 'serial' : 'parallel';

  // Hard override, independent of the scored device tier (brief's explicit
  // case: "saveData → serial and L1" even on an otherwise capable device —
  // the visitor opted out of using their data budget, which this policy
  // treats as an instruction, not a hint).
  if (options.connection?.saveData) {
    downloadMode = 'serial';
    const l1Index = TIER_ORDER.indexOf('L1');
    const currentIndex = TIER_ORDER.indexOf(maxTier);
    if (currentIndex > l1Index) maxTier = 'L1';
  }

  const cacheBudget =
    deviceTier === 'low'
      ? t.cacheBudgetLow
      : deviceTier === 'high'
        ? t.cacheBudgetHigh
        : t.cacheBudgetMid;

  return {
    proxyVariant: selectedVariant,
    maxTier,
    downloadMode,
    cacheBudget,
    deviceTier,
  };
}

export const QualityPolicy = {
  choose: chooseQuality,
  classifyDeviceTier,
  desiredProxyWidth,
  orderVariantsByPreferredWidth,
};
