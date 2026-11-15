import { describe, it, expect } from 'vitest';
import type { User } from '@kc/domain';
import { mergeStatsChange } from '../mergeStatsChange';

const CHANGE = {
  karmaPoints: 40,
  followersCount: 2,
  followingCount: 3,
  itemsGivenCount: 4,
  itemsReceivedCount: 5,
  postsCreatedTotal: 9,
  openPostsCount: 6,
};

const user = (over: Partial<User> = {}): User =>
  ({
    userId: 'u1',
    displayName: 'Dana',
    karmaPoints: 0,
    followersCount: 0,
    followingCount: 0,
    itemsGivenCount: 0,
    itemsReceivedCount: 0,
    activePostsCountInternal: 0,
    ...over,
  }) as unknown as User;

describe('mergeStatsChange (FR-KARMA-009)', () => {
  it('writes the pushed counters over the cached profile and keeps every other field', () => {
    expect(mergeStatsChange(user(), CHANGE)).toMatchObject({
      displayName: 'Dana',
      karmaPoints: 40,
      followersCount: 2,
      followingCount: 3,
      itemsGivenCount: 4,
      itemsReceivedCount: 5,
      activePostsCountInternal: 6,
    });
  });

  it('returns the same object when nothing changed, so no screen re-renders', () => {
    const prev = user({
      karmaPoints: 40,
      followersCount: 2,
      followingCount: 3,
      itemsGivenCount: 4,
      itemsReceivedCount: 5,
      activePostsCountInternal: 6,
    });
    expect(mergeStatsChange(prev, CHANGE)).toBe(prev);
  });

  it('leaves an empty cache empty (the profile has not been read yet)', () => {
    expect(mergeStatsChange(undefined, CHANGE)).toBeUndefined();
    expect(mergeStatsChange(null, CHANGE)).toBeNull();
  });
});
