import type * as THREE from 'three';
import type { QualityPolicyOptions } from './quality-policy.js';

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
  addEventListener?: (type: 'change', cb: () => void) => void;
}

interface NavigatorWithExtras {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

function readConnection(nav: NavigatorWithExtras): QualityPolicyOptions['connection'] {
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  if (!connection) return undefined;
  const effectiveType = connection.effectiveType;
  const isKnownType =
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    effectiveType === '3g' ||
    effectiveType === '4g';
  return {
    effectiveType: isKnownType ? effectiveType : undefined,
    downlink: connection.downlink,
    saveData: connection.saveData,
  };
}

function readRendererString(renderer: THREE.WebGLRenderer): string | undefined {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!info) return undefined;
  const value = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  return typeof value === 'string' ? value : undefined;
}

function readPrefersReducedData(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-data: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Gathers the real browser/device signals QualityPolicy needs. Everything
 * here is best-effort: any of these APIs can be absent (older Safari has no
 * `navigator.connection` or `deviceMemory` at all) and this always returns a
 * usable (if partial) object rather than throwing.
 */
export function detectDeviceSignals(
  renderer: THREE.WebGLRenderer,
): Omit<QualityPolicyOptions, 'canvasCssWidth' | 'dpr'> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as NavigatorWithExtras;
  return {
    connection: readConnection(nav),
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    rendererString: readRendererString(renderer),
    prefersReducedData: readPrefersReducedData(),
  };
}
