import { describe, expect, it } from 'vitest';
import { mergeSelfRealtimeUser } from '../mergeSelfRealtimeUser';
import type { User } from '@kc/domain';

const base = { userId: 'u1', displayName: 'A', karmaPoints: 8, followersCount: 1, contactPhone: '050' } as unknown as User;

describe('mergeSelfRealtimeUser', () => {
  it('keeps private karma total when realtime payload omits it', () => {
    const next = { userId: 'u1', displayName: 'B', karmaPoints: undefined, followersCount: 2 } as unknown as User;
    const out = mergeSelfRealtimeUser(base, next);
    expect(out.karmaPoints).toBe(8);
    expect(out.displayName).toBe('B');
    expect(out.followersCount).toBe(2);
    expect(out.contactPhone).toBe('050');
  });
  it('applies a new karma total when present', () => {
    const out = mergeSelfRealtimeUser(base, { ...base, karmaPoints: 13 });
    expect(out.karmaPoints).toBe(13);
  });
  it('returns next when no cached user', () => {
    expect(mergeSelfRealtimeUser(undefined, base)).toBe(base);
  });
});
