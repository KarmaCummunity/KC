import { describe, it, expect } from 'vitest';
import { FollowError, isFollowError } from '../errors';

describe('FollowError', () => {
  it('is an Error subclass with name="FollowError" and carries code/message', () => {
    const err = new FollowError('self_follow', 'cannot follow yourself');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FollowError);
    expect(err.name).toBe('FollowError');
    expect(err.code).toBe('self_follow');
    expect(err.message).toBe('cannot follow yourself');
    expect(err.cooldownUntil).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it('cooldown_active code accepts a cooldownUntil ISO timestamp via opts', () => {
    const err = new FollowError('cooldown_active', 'too soon', {
      cooldownUntil: '2026-06-01T00:00:00.000Z',
    });
    expect(err.code).toBe('cooldown_active');
    expect(err.cooldownUntil).toBe('2026-06-01T00:00:00.000Z');
  });

  it('forwards a cause via opts.cause (separate slot from opts.cooldownUntil)', () => {
    const cause = new Error('inner');
    const err = new FollowError('blocked_relationship', 'blocked', { cause });
    expect(err.cause).toBe(cause);
  });

  it('opts is optional — constructor works with just (code, message)', () => {
    const err = new FollowError('request_required', 'x');
    expect(err.cooldownUntil).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it('preserves every code in the FollowErrorCode union', () => {
    for (const code of [
      'self_follow', 'blocked_relationship', 'cooldown_active', 'request_required',
      'account_not_active', 'rate_limited', 'user_not_found', 'privacy_mode_no_change', 'unknown',
    ] as const) {
      expect(new FollowError(code, code).code).toBe(code);
    }
  });
});

describe('isFollowError', () => {
  it('returns true only for FollowError', () => {
    expect(isFollowError(new FollowError('user_not_found', ''))).toBe(true);
    expect(isFollowError(new Error('plain'))).toBe(false);
    expect(isFollowError({ code: 'user_not_found', name: 'FollowError' })).toBe(false);
    expect(isFollowError(null)).toBe(false);
  });
});
