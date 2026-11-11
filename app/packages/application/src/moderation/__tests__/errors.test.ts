import { describe, it, expect } from 'vitest';
import {
  AccountGateError,
  InfrastructureError,
  InvalidRestoreStateError,
  ModerationError,
  ModerationForbiddenError,
} from '../errors';

describe('ModerationError (base)', () => {
  it('carries code, name="ModerationError", message defaults to code when omitted', () => {
    const err = new ModerationError('forbidden');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err.name).toBe('ModerationError');
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('forbidden');
  });

  it('explicit message wins over the code default', () => {
    const err = new ModerationError('target_not_found', 'post p_1 has no row');
    expect(err.message).toBe('post p_1 has no row');
    expect(err.code).toBe('target_not_found');
  });

  it('forwards a cause when supplied', () => {
    const cause = new Error('rls');
    expect(new ModerationError('invalid_sanction_reason', 'x', cause).cause).toBe(cause);
  });

  it('preserves a sample of every code (FR-MOD-007/010, FR-ADMIN-002..007)', () => {
    for (const code of [
      'forbidden', 'invalid_restore_state', 'invalid_target_state',
      'report_not_open', 'invalid_sanction_reason', 'cannot_sanction_self',
      'cannot_sanction_admin', 'account_pending_deletion', 'message_not_found',
      'target_not_found', 'cannot_report_self', 'unknown',
    ] as const) {
      expect(new ModerationError(code).code).toBe(code);
    }
  });
});

describe('ModerationForbiddenError (subclass)', () => {
  it('is a ModerationError with code="forbidden" and a fixed admin-permission message', () => {
    const err = new ModerationForbiddenError();
    expect(err).toBeInstanceOf(ModerationForbiddenError);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('admin permission required');
    expect(err.name).toBe('ModerationForbiddenError');
  });

  it('forwards a cause when supplied', () => {
    const cause = new Error('rls');
    expect(new ModerationForbiddenError(cause).cause).toBe(cause);
  });
});

describe('InvalidRestoreStateError (subclass)', () => {
  it('is a ModerationError with code="invalid_restore_state" and a fixed message', () => {
    const err = new InvalidRestoreStateError();
    expect(err).toBeInstanceOf(InvalidRestoreStateError);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err.code).toBe('invalid_restore_state');
    expect(err.message).toBe('target is not in a restorable state');
    expect(err.name).toBe('InvalidRestoreStateError');
  });
});

describe('AccountGateError', () => {
  it('carries reason, until, and a message of "account_gate:<reason>"', () => {
    const until = new Date('2026-06-01T00:00:00.000Z');
    const err = new AccountGateError('banned', until);
    expect(err).toBeInstanceOf(AccountGateError);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe('banned');
    expect(err.until).toBe(until);
    expect(err.message).toBe('account_gate:banned');
    expect(err.name).toBe('AccountGateError');
  });

  it('accepts until=null (e.g. for permanent bans)', () => {
    const err = new AccountGateError('suspended_admin', null);
    expect(err.until).toBeNull();
  });

  it('preserves each AccountGateRejectionReason', () => {
    for (const reason of ['banned', 'suspended_admin', 'suspended_for_false_reports'] as const) {
      expect(new AccountGateError(reason, null).reason).toBe(reason);
    }
  });
});

describe('InfrastructureError', () => {
  it('wraps unexpected infrastructure failures with cause + name="InfrastructureError"', () => {
    const cause = new Error('connection lost');
    const err = new InfrastructureError('repo failure', cause);
    expect(err).toBeInstanceOf(InfrastructureError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InfrastructureError');
    expect(err.message).toBe('repo failure');
    expect(err.cause).toBe(cause);
  });

  it('cause is optional', () => {
    expect(new InfrastructureError('boom').cause).toBeUndefined();
  });
});
