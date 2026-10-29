export { createViewer } from './create-viewer.js';
import { defineUnderstudyViewerElement } from './custom-element.js';
export type {
  Viewer,
  ViewerOptions,
  ViewerMetrics,
  ViewerState,
  StateChangeEventDetail,
  MetricsEventDetail,
  ErrorEventDetail,
} from './types.js';

export { UnderstudyViewerElement, defineUnderstudyViewerElement } from './custom-element.js';

export {
  QualityPolicy,
  chooseQuality,
  classifyDeviceTier,
  desiredProxyWidth,
  orderVariantsByPreferredWidth,
  QUALITY_POLICY_THRESHOLDS,
  TIER_ORDER,
  type QualityPolicyOptions,
  type QualityPolicyDecision,
  type ChooseQualityInput,
  type ConnectionInfo,
  type ConnectionEffectiveType,
  type DeviceTier,
  type DownloadMode,
  type TierId,
} from './quality-policy.js';

export {
  transition,
  IllegalTransitionError,
  ALL_VIEWER_STATES,
  ALL_VIEWER_EVENT_TYPES,
  type ViewerEvent,
  type ViewerEventType,
} from './state-machine.js';

export {
  azimuthDeltaForPointerDelta,
  dragVelocityPxPerMs,
  isFastDrag,
  FAST_DRAG_THRESHOLD_PX_PER_MS,
  type DragSample,
} from './scrub.js';

// Side effect, on import, matching the frozen `<understudy-viewer>` tag
// being usable the moment this package is loaded (§5.6) — a no-op outside
// a browser (typeof customElements guard inside) and idempotent if this
// module is evaluated more than once (customElements.get guard inside).
defineUnderstudyViewerElement();
