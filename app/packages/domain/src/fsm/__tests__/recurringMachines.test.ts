import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { rideSeriesMachine } from '../machines/rideSeries';
import { standingOrderMachine } from '../machines/standingOrder';
import { postSeriesMachine } from '../machines/postSeries';
import { standingOrderActions } from '../../payments/standingOrderActions';

describe.each([
  ['ride series', rideSeriesMachine],
  ['standing order', standingOrderMachine],
])('%s machine', (_name, machine) => {
  it('pauses and resumes', () => {
    expect(canTransition(machine, 'active', 'paused').ok).toBe(true);
    expect(canTransition(machine, 'paused', 'active').ok).toBe(true);
  });

  it('cancels from either state, for good', () => {
    expect(canTransition(machine, 'active', 'cancelled').ok).toBe(true);
    expect(canTransition(machine, 'paused', 'cancelled').ok).toBe(true);
    expect(isTerminal(machine, 'cancelled')).toBe(true);
    expect(canTransition(machine, 'cancelled', 'active')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});

describe('post series machine (FR-POST-024)', () => {
  it('pauses and resumes', () => {
    expect(canTransition(postSeriesMachine, 'active', 'paused').ok).toBe(true);
    expect(canTransition(postSeriesMachine, 'paused', 'active').ok).toBe(true);
  });

  it('ends from either state, for good', () => {
    expect(canTransition(postSeriesMachine, 'active', 'ended').ok).toBe(true);
    expect(canTransition(postSeriesMachine, 'paused', 'ended').ok).toBe(true);
    expect(isTerminal(postSeriesMachine, 'ended')).toBe(true);
    expect(canTransition(postSeriesMachine, 'ended', 'paused')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});

describe('standingOrderActions', () => {
  it('offers pause and cancel on an active order', () => {
    expect(standingOrderActions('active')).toEqual({ pause: true, resume: false, cancel: true });
  });

  it('offers resume and cancel on a paused order', () => {
    expect(standingOrderActions('paused')).toEqual({ pause: false, resume: true, cancel: true });
  });

  it('offers nothing on a cancelled order or an unknown status', () => {
    expect(standingOrderActions('cancelled')).toEqual({ pause: false, resume: false, cancel: false });
    expect(standingOrderActions('past_due')).toEqual({ pause: false, resume: false, cancel: false });
  });
});
