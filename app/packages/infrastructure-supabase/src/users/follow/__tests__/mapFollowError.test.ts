import { describe, it, expect } from 'vitest';
import { FollowError } from '@kc/application';
import { BackendRuleError } from '@kc/domain';
import { mapFollowError } from '../mapFollowError';

const rule = (reason: string, details?: string) => new BackendRuleError(reason, 'rpc:follow_user', { details });

describe('mapFollowError', () => {
  it.each([
    ['self_follow_forbidden', 'self_follow'],
    ['blocked_relationship', 'blocked_relationship'],
    ['account_not_active', 'account_not_active'],
    ['rate_limited', 'rate_limited'],
    ['user_unavailable', 'user_not_found'],
  ])('maps the stable reason %s to the code %s', (reason, code) => {
    const mapped = mapFollowError(rule(reason));

    expect(mapped).toBeInstanceOf(FollowError);
    expect(mapped.code).toBe(code);
    expect(mapped.cooldownUntil).toBeUndefined();
  });

  it('reads the end of the cooldown from the detail of the refusal', () => {
    const mapped = mapFollowError(
      rule('follow_request_cooldown_active', 'cooldown_until=2026-06-01T12:30:00Z'),
    );

    expect(mapped.code).toBe('cooldown_active');
    expect(mapped.cooldownUntil).toBe('2026-06-01T12:30:00Z');
  });

  it('keeps the cooldown code without a date when the detail is missing', () => {
    const mapped = mapFollowError(rule('follow_request_cooldown_active'));

    expect(mapped.code).toBe('cooldown_active');
    expect(mapped.cooldownUntil).toBeUndefined();
  });

  it.each(['invalid_rate_limit_args', 'unauthenticated', 'invalid_decision', 'something_new'])(
    'maps the refusal %s that the follow flow has no code for to `unknown`',
    (reason) => {
      expect(mapFollowError(rule(reason)).code).toBe('unknown');
    },
  );

  it('keeps the refusal as the cause and its reason as the message', () => {
    const refusal = rule('blocked_relationship');

    const mapped = mapFollowError(refusal);

    expect(mapped.message).toBe('blocked_relationship');
    expect(mapped.cause).toBe(refusal);
  });
});
