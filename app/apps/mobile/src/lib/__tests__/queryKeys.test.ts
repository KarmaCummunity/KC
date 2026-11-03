import { describe, it, expect } from 'vitest';
import { userProfileKeys } from '../queryKeys';

describe('userProfileKeys', () => {
  it('builds a stable cache key tuple by user id', () => {
    const key = userProfileKeys.byId('user-123');
    expect(key).toEqual(['user-profile', 'user-123']);
  });

  it('preserves distinct keys for different user ids', () => {
    const keyA = userProfileKeys.byId('user-a');
    const keyB = userProfileKeys.byId('user-b');
    expect(keyA).not.toEqual(keyB);
  });
});
