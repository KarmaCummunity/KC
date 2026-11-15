import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseFollowSuggestionsRepository } from '../SupabaseFollowSuggestionsRepository';

const ok = (data: unknown) => ({ data, error: null });

// M03 / M04 — migration 0031: suggestions and the completeness nudge are server reads again.
describe('SupabaseFollowSuggestionsRepository', () => {
  it('maps the suggestions and passes the limit', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        rpc_follow_suggestions: ok([{
          user_id: 'u2', display_name: 'Dana', share_handle: 'dana', avatar_url: null, city_name: 'Haifa',
          followers_count: 4, reason: 'same_city', score: 4.6, verification_level: 2,
        }]),
      },
    });
    const rows = await new SupabaseFollowSuggestionsRepository(client as never).listSuggestions(20);
    expect(rows).toEqual([{
      userId: 'u2', displayName: 'Dana', shareHandle: 'dana', avatarUrl: null, cityName: 'Haifa',
      followersCount: 4, reason: 'same_city', verificationLevel: 2,
    }]);
    expect(callsTo(calls, 'rpc_follow_suggestions')[0]?.args).toEqual({ p_limit: 20 });
  });

  it('reads the caller\'s completeness and tolerates a malformed answer', async () => {
    const good = createFakeClient({
      rpc: { rpc_profile_completeness: ok({ score: 60, missing: ['avatar', 7], verified: true, showVerifiedBadge: true }) },
    });
    expect(await new SupabaseFollowSuggestionsRepository(good.client as never).getProfileCompleteness()).toEqual({
      score: 60, missing: ['avatar'], verified: true, showVerifiedBadge: true,
    });
    const bad = createFakeClient({ rpc: { rpc_profile_completeness: ok(null) } });
    expect(await new SupabaseFollowSuggestionsRepository(bad.client as never).getProfileCompleteness()).toEqual({
      score: 0, missing: [], verified: false, showVerifiedBadge: false,
    });
  });
});
