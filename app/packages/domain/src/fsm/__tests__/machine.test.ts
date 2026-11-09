import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors';
import { TransitionError } from '../TransitionError';
import { assertTransition, canTransition, defineMachine, isTerminal } from '../machine';

const gate = defineMachine({
  id: 'gate',
  states: ['a', 'b', 'c'] as const,
  edges: [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'c', roles: ['owner'] as const },
  ],
});

describe('defineMachine', () => {
  it('rejects a bad id, empty states, duplicates, and bad edges', () => {
    expect(() => defineMachine({ id: 'Bad', states: ['a'], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({ id: 'ok', states: [], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({ id: 'ok', states: ['a', 'a'], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a'], edges: [{ from: 'a', to: 'z' }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok',
      states: ['a', 'b'],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a', 'b'], edges: [{ from: 'a', to: 'b', roles: [] }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a', 'b'], edges: [{ from: 'a', to: 'b', roles: ['owner', 'owner'] }],
    })).toThrow(ValidationError);
  });
});

describe('canTransition', () => {
  it('treats the same known status as an unchanged success', () => {
    expect(canTransition(gate, 'a', 'a')).toEqual({ ok: true, changed: false });
  });

  it('allows an unrestricted edge for any role', () => {
    expect(canTransition(gate, 'a', 'b')).toEqual({ ok: true, changed: true });
    expect(canTransition(gate, 'a', 'b', 'stranger')).toEqual({ ok: true, changed: true });
  });

  it('enforces listed roles and rejects a missing role', () => {
    expect(canTransition(gate, 'a', 'c', 'owner')).toEqual({ ok: true, changed: true });
    expect(canTransition(gate, 'a', 'c', 'stranger')).toEqual({ ok: false, code: 'forbidden_role' });
    expect(canTransition(gate, 'a', 'c')).toEqual({ ok: false, code: 'forbidden_role' });
  });

  it('rejects unknown statuses before the same-status rule', () => {
    expect(canTransition(gate, 'nope', 'nope')).toEqual({ ok: false, code: 'unknown_state' });
    expect(canTransition(gate, 'a', 'z')).toEqual({ ok: false, code: 'unknown_state' });
  });

  it('rejects a missing edge', () => {
    expect(canTransition(gate, 'b', 'a')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});

describe('assertTransition', () => {
  it('returns the ok result or throws TransitionError with details', () => {
    expect(assertTransition(gate, 'a', 'b')).toEqual({ ok: true, changed: true });
    expect(() => assertTransition(gate, 'b', 'a')).toThrow(TransitionError);
    try {
      assertTransition(gate, 'a', 'c');
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError);
      const thrown = error as TransitionError;
      expect(thrown.code).toBe('forbidden_role');
      expect(thrown.message).toBe('forbidden_role');
      expect(thrown.details).toEqual({ machine: 'gate', from: 'a', to: 'c' });
    }
  });
});

describe('isTerminal', () => {
  it('is true only for a known status with no outgoing edge', () => {
    expect(isTerminal(gate, 'b')).toBe(true);
    expect(isTerminal(gate, 'a')).toBe(false);
    expect(isTerminal(gate, 'missing')).toBe(false);
  });
});
