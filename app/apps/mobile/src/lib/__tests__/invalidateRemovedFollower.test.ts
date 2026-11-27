import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateRemovedFollower } from '../invalidateRemovedFollower';

const owner = { userId: 'owner', shareHandle: 'owner-handle' };
const follower = { userId: 'follower', shareHandle: 'follower-handle' };
const affected = [
  ['followers', 'owner'], ['following', 'follower'],
  ['user-profile', 'owner'], ['user-profile', 'follower'],
  ['profile-other', 'owner-handle'], ['profile-other', 'follower-handle'],
  ['follow-state', 'follower', 'owner'],
];

describe('invalidateRemovedFollower', () => {
  it('marks both profiles and the removed follower-to-owner edge stale', () => {
    const client = new QueryClient();
    for (const key of affected) client.setQueryData(key, { cached: true });
    const unaffected = [['followers', 'unrelated'], ['follow-state', 'owner', 'follower']];
    for (const key of unaffected) client.setQueryData(key, { cached: true });

    invalidateRemovedFollower(client, owner, follower);

    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    for (const key of unaffected) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(false);
    client.clear();
  });

  it('does not create query entries for views this client has never loaded', () => {
    const client = new QueryClient();
    invalidateRemovedFollower(client, owner, follower);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.clear();
  });
});
