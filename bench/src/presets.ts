/**
 * docs/01-design.md §10, verbatim: "3g-fast 1.6 Mbps↓ / 150 ms RTT, 4g 9 Mbps
 * / 60 ms, wifi 30 Mbps / 20 ms". Applied per-page via Chromium CDP's
 * `Network.emulateNetworkConditions` (hard-won lesson #4 in the brief: this
 * is the real throttling mechanism, not a stand-in for it — faking it by
 * lowering encode bitrates would change what's being measured).
 */
export interface NetworkPreset {
  readonly id: 'wifi' | '4g' | '3g-fast';
  readonly label: string;
  readonly downloadMbps: number;
  readonly uploadMbps: number;
  readonly rttMs: number;
}

function bytesPerSecond(mbps: number): number {
  return (mbps * 1_000_000) / 8;
}

export const NETWORK_PRESETS: readonly NetworkPreset[] = [
  { id: 'wifi', label: 'wifi (30 Mbps / 20 ms)', downloadMbps: 30, uploadMbps: 30, rttMs: 20 },
  { id: '4g', label: '4g (9 Mbps / 60 ms)', downloadMbps: 9, uploadMbps: 9, rttMs: 60 },
  {
    id: '3g-fast',
    label: '3g-fast (1.6 Mbps / 150 ms)',
    downloadMbps: 1.6,
    uploadMbps: 1.6,
    rttMs: 150,
  },
];

export function toEmulateNetworkConditions(preset: NetworkPreset): {
  offline: boolean;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
} {
  return {
    offline: false,
    downloadThroughput: bytesPerSecond(preset.downloadMbps),
    uploadThroughput: bytesPerSecond(preset.uploadMbps),
    latency: preset.rttMs,
  };
}
