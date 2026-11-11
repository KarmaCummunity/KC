import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { accountStatusMachine } from '../machines/accountStatus';

/** True when the move is a legal, state-changing edge of the account machine. */
const legal = (from: string, to: string) => canTransition(accountStatusMachine, from, to).ok;

describe('account status machine', () => {
  it('suspends, bans and restores per the moderation rules', () => {
    expect(legal('active', 'suspended_admin')).toBe(true);
    expect(legal('suspended_admin', 'active')).toBe(true);
    expect(legal('active', 'banned')).toBe(true);
    // A super admin lifts a ban (the RPC checks the role).
    expect(legal('banned', 'active')).toBe(true);
  });

  it('never lets a false-report sanction replace a heavier state', () => {
    expect(legal('active', 'suspended_for_false_reports')).toBe(true);
    expect(legal('banned', 'suspended_for_false_reports')).toBe(false);
    expect(legal('suspended_admin', 'suspended_for_false_reports')).toBe(false);
    expect(legal('pending_deletion', 'suspended_for_false_reports')).toBe(false);
  });

  it('lifts a sanction back to active, escalates it to a suspension or a ban', () => {
    expect(legal('suspended_for_false_reports', 'active')).toBe(true);
    expect(legal('suspended_for_false_reports', 'suspended_admin')).toBe(true);
    expect(legal('suspended_for_false_reports', 'banned')).toBe(true);
  });

  it('restores a deletion to the status saved before it, and moderates no leaving account', () => {
    expect(legal('active', 'pending_deletion')).toBe(true);
    expect(legal('pending_deletion', 'active')).toBe(true);
    expect(legal('pending_deletion', 'pending_verification')).toBe(true);
    expect(legal('pending_deletion', 'suspended_admin')).toBe(false);
    expect(legal('pending_deletion', 'banned')).toBe(false);
    expect(legal('banned', 'pending_deletion')).toBe(false);
  });

  it('has no deleted state: the purge removes the row', () => {
    expect(canTransition(accountStatusMachine, 'active', 'deleted')).toEqual({ ok: false, code: 'unknown_state' });
  });

  it('has no dead end: every state can be left', () => {
    for (const state of accountStatusMachine.states) {
      expect(isTerminal(accountStatusMachine, state)).toBe(false);
    }
  });
});
