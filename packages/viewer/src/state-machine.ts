/**
 * The viewer's state machine (docs/01-design.md §6, Viewer.state per §5.6).
 * A pure reducer: `transition` either returns the one legal next state for
 * (state, event) or throws. No other code path may assign `Viewer.state`
 * directly — this is what makes an illegal transition a thrown error
 * instead of a silently-wrong UI.
 */

export type ViewerState =
  | 'idle'
  | 'proxy-loading'
  | 'proxy-ready'
  | 'warming'
  | 'handoff'
  | 'live'
  | 'upgrading'
  | 'settled'
  | 'error';

export type ViewerEventType =
  | 'manifest-loaded'
  | 'proxy-ready'
  | 'proxy-degraded'
  | 'tier-warm'
  | 'handoff-start'
  | 'handoff-skip'
  | 'handoff-done'
  | 'upgrade-start'
  | 'upgrade-done'
  | 'settle'
  | 'fail';

export interface ViewerEvent {
  type: ViewerEventType;
}

/**
 * Happy-path transitions only; `fail` is handled generically in
 * `transition` below since it is legal from every non-terminal state and
 * listing it per-state here would just be noise.
 *
 * - idle → proxy-loading: manifest fetched/validated, proxy attempt started.
 * - proxy-loading → proxy-ready: the selected variant's first frame decoded.
 * - proxy-loading → warming: no usable proxy variant (degraded) — skip
 *   proxy-ready and handoff entirely (§8, "never block on the proxy"),
 *   start loading L0 immediately.
 * - proxy-ready → warming: L0's loadTier()+warm() is now in flight, while
 *   the visitor may still be scrubbing the proxy.
 * - warming → handoff: warm() resolved and the handoff rule (§6) is
 *   satisfied; begin the 150 ms cross-fade.
 * - warming → live: degraded path's warm() resolved — nothing to fade
 *   from, so skip the handoff state entirely.
 * - handoff → live: the cross-fade animation finished.
 * - live → upgrading: a higher tier finished loading and warming.
 * - upgrading → live: the swap to the new tier completed.
 * - live → settled: no further tier is pending (maxTier reached or every
 *   remaining tier failed after its retry).
 */
const TRANSITIONS: Record<ViewerState, Partial<Record<ViewerEventType, ViewerState>>> = {
  idle: { 'manifest-loaded': 'proxy-loading' },
  'proxy-loading': { 'proxy-ready': 'proxy-ready', 'proxy-degraded': 'warming' },
  'proxy-ready': { 'tier-warm': 'warming' },
  warming: { 'handoff-start': 'handoff', 'handoff-skip': 'live' },
  handoff: { 'handoff-done': 'live' },
  live: { 'upgrade-start': 'upgrading', settle: 'settled' },
  upgrading: { 'upgrade-done': 'live' },
  settled: {},
  error: {},
};

export class IllegalTransitionError extends Error {
  constructor(state: ViewerState, event: ViewerEventType) {
    super(`ViewerStateMachine: event "${event}" is not allowed in state "${state}"`);
    this.name = 'IllegalTransitionError';
  }
}

export function transition(state: ViewerState, event: ViewerEvent): ViewerState {
  if (event.type === 'fail') {
    if (state === 'error') throw new IllegalTransitionError(state, event.type);
    return 'error';
  }
  const next = TRANSITIONS[state][event.type];
  if (!next) throw new IllegalTransitionError(state, event.type);
  return next;
}

export const ALL_VIEWER_STATES: readonly ViewerState[] = [
  'idle',
  'proxy-loading',
  'proxy-ready',
  'warming',
  'handoff',
  'live',
  'upgrading',
  'settled',
  'error',
];

export const ALL_VIEWER_EVENT_TYPES: readonly ViewerEventType[] = [
  'manifest-loaded',
  'proxy-ready',
  'proxy-degraded',
  'tier-warm',
  'handoff-start',
  'handoff-skip',
  'handoff-done',
  'upgrade-start',
  'upgrade-done',
  'settle',
  'fail',
];
