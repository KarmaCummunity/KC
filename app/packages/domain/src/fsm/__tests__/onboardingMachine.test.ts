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

  it('never moves a member back', () => {
    expect(canTransition(onboardingMachine, 'completed', 'pending_avatar')).toEqual({
      ok: false,
      code: 'illegal_transition',
    });
    expect(canTransition(onboardingMachine, 'completed', 'pending_basic_info')).toEqual({
      ok: false,
      code: 'forbidden_role',
    });
    expect(canTransition(onboardingMachine, 'pending_avatar', 'pending_basic_info')).toEqual({
      ok: false,
      code: 'forbidden_role',
    });
  });

  it('lets only the developer reset tool return to step 1', () => {
    expect(canTransition(onboardingMachine, 'completed', 'pending_basic_info', 'dev_reset').ok).toBe(true);
    expect(canTransition(onboardingMachine, 'pending_avatar', 'pending_basic_info', 'dev_reset').ok).toBe(true);
  });

  it('has no dead end: a reset can leave every stage', () => {
    for (const state of onboardingMachine.states) {
      expect(isTerminal(onboardingMachine, state)).toBe(false);
    }
  });
});
