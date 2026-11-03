// D33 / D61 — a suspended user stays signed in (browses, chats with support);
// banned users are signed out; pending verification goes back to sign-in.
import { describe, expect, it } from 'vitest';
import { accountGateDecision } from '../accountGateDecision';

describe('accountGateDecision', () => {
  it('keeps allowed accounts as they are', () => {
    expect(accountGateDecision({ allowed: true })).toEqual({ action: 'allow' });
  });

  it('keeps suspended users signed in with their suspension details', () => {
    expect(accountGateDecision({ allowed: false, reason: 'suspended_admin', until: '2026-11-30T00:00:00Z' })).toEqual({
      action: 'suspended',
      reason: 'suspended_admin',
      until: '2026-11-30T00:00:00Z',
    });
    expect(accountGateDecision({ allowed: false, reason: 'suspended_for_false_reports' }).action).toBe('suspended');
  });

  it('signs out banned users and unverified ones, defaulting unknown reasons to blocked', () => {
    expect(accountGateDecision({ allowed: false, reason: 'banned' })).toEqual({ action: 'blocked', reason: 'banned', until: null });
    expect(accountGateDecision({ allowed: false, reason: 'pending_verification' as never }).action).toBe('reverify');
    expect(accountGateDecision({ allowed: false }).action).toBe('blocked');
  });
});
