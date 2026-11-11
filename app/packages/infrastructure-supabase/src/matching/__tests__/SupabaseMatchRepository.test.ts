import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, makeCard, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseMatchRepository, mapMatchRow } from '../SupabaseMatchRepository';

// Generated RETURNS TABLE columns are non-null; the real answers carry nulls (no answer yet).
const ROW = {
  match_id: 'm1', status: 'suggested', score: 0.8123, distance_km: 4.5, world_slug: 'items', my_role: 'offer',
  my_post_id: 'mine', my_post_title: 'My sofa', my_response: null, other_response: 'accepted', llm_reason: 'close by',
  created_at: '2026-01-01T00:00:00Z', other_post: makeCard({ id: 'theirs', title: 'Need a sofa', description: 'Please' }),
} as unknown as Parameters<typeof mapMatchRow>[0];

describe('mapMatchRow', () => {
  it('reads the other side from the card and converts the numerics', () => {
    expect(mapMatchRow(ROW)).toEqual({
      candidateId: 'm1', status: 'suggested', score: 0.8123, distanceKm: 4.5, worldSlug: 'items', myRole: 'offer',
      myListingId: 'mine', myListingTitle: 'My sofa', otherListingId: 'theirs', otherListingTitle: 'Need a sofa',
      otherListingSummary: 'Please',
      otherOwner: { userId: 'owner-1', displayName: 'Dana', avatarUrl: 'https://img/dana.png', shareHandle: 'dana' },
      myResponse: null, otherResponse: 'accepted', reason: 'close by', createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('leaves the owner empty while the poster is masked', () => {
    const masked = mapMatchRow({ ...ROW, other_post: makeCard({ owner_id: null, owner_display_name: null, owner_share_handle: null, owner_avatar_url: null }) });
    expect(masked.otherOwner).toEqual({ userId: '', displayName: null, avatarUrl: null, shareHandle: null });
  });
});

describe('SupabaseMatchRepository', () => {
  it('lists the caller\'s pairs', async () => {
    const { client, calls } = createFakeClient({ rpc: { my_matches: ok([ROW]) } });
    expect(await new SupabaseMatchRepository(client).listMine(5)).toHaveLength(1);
    expect(callsTo(calls, 'my_matches')[0]?.args).toEqual({ p_limit: 5 });
  });

  it('answers a pair with a boolean and reports whether both accepted', async () => {
    const { client, calls } = createFakeClient({ rpc: { match_respond: ok('accepted') } });
    const repo = new SupabaseMatchRepository(client);
    expect(await repo.respond('m1', 'accept')).toEqual({ status: 'accepted', mutual: true });
    expect(callsTo(calls, 'match_respond')[0]?.args).toEqual({ p_match_id: 'm1', p_accept: true });
    const waiting = createFakeClient({ rpc: { match_respond: ok('suggested') } });
    expect(await new SupabaseMatchRepository(waiting.client).respond('m1', 'decline')).toEqual({ status: 'suggested', mutual: false });
  });

  it('keeps a refusal reason and reports a missing function', async () => {
    const refused = createFakeClient({ rpc: { match_respond: fail('P0001', 'match_not_open') } });
    await expect(new SupabaseMatchRepository(refused.client).respond('m1', 'accept')).rejects.toMatchObject({ constructor: BackendRuleError, reason: 'match_not_open' });
    const missing = createFakeClient({ rpc: { my_matches: fail('PGRST202', 'nope') } });
    await expect(new SupabaseMatchRepository(missing.client).listMine()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('degrades the admin quality report: the baseline has none (M14)', async () => {
    const { client, calls } = createFakeClient();
    await expect(new SupabaseMatchRepository(client).qualityByWorld(30)).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(calls).toHaveLength(0);
  });
});
