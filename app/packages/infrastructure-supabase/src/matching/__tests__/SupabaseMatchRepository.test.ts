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

  it('keeps every status of the match machine and reads an unknown one as expired', () => {
    for (const status of ['suggested', 'accepted', 'declined', 'expired']) {
      expect(mapMatchRow({ ...ROW, status }).status).toBe(status);
    }
    expect(mapMatchRow({ ...ROW, status: 'archived' }).status).toBe('expired');
    expect(mapMatchRow({ ...ROW, status: null as unknown as string }).status).toBe('expired');
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

  it('reads the admin quality report per world, rates as numbers', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        admin_match_quality: ok([
          {
            world_slug: 'items', world_label_he: 'i', world_label_en: 'Items', notified_pairs: 2, responses: 3, accepted: 2,
            precision_proxy: '0.6667', chat_pairs: 1, chat_rate: '0.5000', completed_pairs: 1, completion_rate: '0.5000',
          },
          {
            world_slug: 'food', world_label_he: 'f', world_label_en: 'Food', notified_pairs: 1, responses: 0, accepted: 0,
            precision_proxy: null, chat_pairs: 0, chat_rate: 0, completed_pairs: 0, completion_rate: 0,
          },
        ]),
      },
    });
    expect(await new SupabaseMatchRepository(client).qualityByWorld(60)).toEqual([
      {
        worldSlug: 'items', worldLabelHe: 'i', worldLabelEn: 'Items', notifiedPairs: 2, responses: 3, accepted: 2,
        precisionProxy: 0.6667, chatPairs: 1, chatRate: 0.5, completedPairs: 1, completionRate: 0.5,
      },
      {
        worldSlug: 'food', worldLabelHe: 'f', worldLabelEn: 'Food', notifiedPairs: 1, responses: 0, accepted: 0,
        precisionProxy: null, chatPairs: 0, chatRate: 0, completedPairs: 0, completionRate: 0,
      },
    ]);
    expect(callsTo(calls, 'admin_match_quality')[0]?.args).toEqual({ p_days: 60 });
  });

  it('keeps the staff refusal and reports a missing report function', async () => {
    const refused = createFakeClient({ rpc: { admin_match_quality: fail('42501', 'forbidden') } });
    await expect(new SupabaseMatchRepository(refused.client).qualityByWorld()).rejects.not.toBeInstanceOf(BackendUnavailableError);
    const missing = createFakeClient({ rpc: { admin_match_quality: fail('PGRST202', 'missing') } });
    await expect(new SupabaseMatchRepository(missing.client).qualityByWorld()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
