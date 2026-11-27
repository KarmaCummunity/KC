import { describe, expect, it } from 'vitest';
import { USER_A } from '../../../__tests__/support/testTokens';
import { callerOf, MissingCallerError } from '../caller.decorator';

describe('callerOf', () => {
  it('returns the identity the guard recorded', () => {
    const identity = { userId: USER_A, claims: { sub: USER_A } };

    expect(callerOf({ identity })).toBe(identity);
  });

  it('throws on a route no guard authenticated', () => {
    expect(() => callerOf({})).toThrow(MissingCallerError);
  });
});
