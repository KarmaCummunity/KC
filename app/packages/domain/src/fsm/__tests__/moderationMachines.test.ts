import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { followRequestMachine } from '../machines/followRequest';
import { reportMachine } from '../machines/report';

describe('report machine', () => {
  it('resolves an open report once, as a confirmation or a dismissal', () => {
    expect(canTransition(reportMachine, 'open', 'confirmed_violation', 'admin')).toEqual({ ok: true, changed: true });
    expect(canTransition(reportMachine, 'open', 'dismissed_no_violation', 'admin')).toEqual({ ok: true, changed: true });
    expect(canTransition(reportMachine, 'open', 'confirmed_violation')).toEqual({ ok: false, code: 'forbidden_role' });
  });

  it('never reopens or flips a resolved report', () => {
    expect(canTransition(reportMachine, 'dismissed_no_violation', 'open').ok).toBe(false);
    expect(canTransition(reportMachine, 'dismissed_no_violation', 'confirmed_violation').ok).toBe(false);
    expect(canTransition(reportMachine, 'confirmed_violation', 'dismissed_no_violation').ok).toBe(false);
    expect(isTerminal(reportMachine, 'confirmed_violation')).toBe(true);
    expect(isTerminal(reportMachine, 'dismissed_no_violation')).toBe(true);
  });
});

describe('follow request machine', () => {
  it('resolves a pending request by accept, reject or cancel', () => {
    expect(canTransition(followRequestMachine, 'pending', 'accepted', 'target').ok).toBe(true);
    expect(canTransition(followRequestMachine, 'pending', 'rejected', 'target').ok).toBe(true);
    expect(canTransition(followRequestMachine, 'pending', 'cancelled', 'requester').ok).toBe(true);
    expect(canTransition(followRequestMachine, 'pending', 'cancelled', 'system').ok).toBe(true);
    expect(canTransition(followRequestMachine, 'pending', 'accepted', 'requester').ok).toBe(false);
  });

  it('keeps every outcome final', () => {
    expect(canTransition(followRequestMachine, 'rejected', 'pending')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(canTransition(followRequestMachine, 'cancelled', 'accepted').ok).toBe(false);
    expect(canTransition(followRequestMachine, 'accepted', 'rejected').ok).toBe(false);
    for (const outcome of ['accepted', 'rejected', 'cancelled']) {
      expect(isTerminal(followRequestMachine, outcome)).toBe(true);
    }
  });
});
