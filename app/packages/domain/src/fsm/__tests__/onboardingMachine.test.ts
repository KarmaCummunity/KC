import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { onboardingMachine } from '../machines/onboarding';

describe('onboarding machine', () => {
  it('moves a member forward through the wizard', () => {
    expect(canTransition(onboardingMachine, 'pending_basic_info', 'pending_avatar')).toEqual({ ok: true, changed: true });
    expect(canTransition(onboardingMachine, 'pending_avatar', 'completed')).toEqual({ ok: true, changed: true });
  });

  it('reconciles a deferred profile straight to completed (FR-AUTH-015)', () => {
    expect(canTransition(onboardingMachine, 'pending_basic_info', 'completed').ok).toBe(true);
  });

  it('treats a repeated step as a no-op', () => {
    expect(canTransition(onboardingMachine, 'pending_avatar', 'pending_avatar')).toEqual({ ok: true, changed: false });
  });

  it('never moves a member back, and the developer reset is gone', () => {
    for (const [from, to] of [
      ['completed', 'pending_avatar'],
      ['completed', 'pending_basic_info'],
      ['pending_avatar', 'pending_basic_info'],
    ] as const) {
      expect(canTransition(onboardingMachine, from, to)).toEqual({ ok: false, code: 'illegal_transition' });
      expect(canTransition(onboardingMachine, from, to, 'dev_reset')).toEqual({
        ok: false,
        code: 'illegal_transition',
      });
    }
  });

  it('ends at completed: it is the only terminal stage', () => {
    expect(onboardingMachine.states.filter((state) => isTerminal(onboardingMachine, state))).toEqual(['completed']);
  });
});
