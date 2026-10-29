import { describe, expect, it } from 'vitest';
import {
  ALL_VIEWER_EVENT_TYPES,
  ALL_VIEWER_STATES,
  IllegalTransitionError,
  transition,
  type ViewerState,
} from './state-machine.js';

const ALLOWED: Partial<Record<ViewerState, Partial<Record<string, ViewerState>>>> = {
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

describe('transition (exhaustive)', () => {
  for (const state of ALL_VIEWER_STATES) {
    for (const type of ALL_VIEWER_EVENT_TYPES) {
      const expectedHappyPath = ALLOWED[state]?.[type];
      const isFail = type === 'fail';

      if (expectedHappyPath) {
        it(`${state} --${type}--> ${expectedHappyPath}`, () => {
          expect(transition(state, { type })).toBe(expectedHappyPath);
        });
      } else if (isFail && state !== 'error') {
        it(`${state} --fail--> error`, () => {
          expect(transition(state, { type })).toBe('error');
        });
      } else {
        it(`${state} --${type}--> throws (illegal)`, () => {
          expect(() => transition(state, { type })).toThrow(IllegalTransitionError);
        });
      }
    }
  }

  it('covers every state and every event type (sanity on the table itself)', () => {
    expect(ALL_VIEWER_STATES.length).toBe(9);
    expect(ALL_VIEWER_EVENT_TYPES.length).toBe(11);
  });

  it('error is terminal: fail is illegal once already in error', () => {
    expect(() => transition('error', { type: 'fail' })).toThrow(IllegalTransitionError);
  });

  it('settled is terminal in the happy path but can still fail', () => {
    expect(transition('settled', { type: 'fail' })).toBe('error');
    expect(() => transition('settled', { type: 'settle' })).toThrow(IllegalTransitionError);
  });
});
