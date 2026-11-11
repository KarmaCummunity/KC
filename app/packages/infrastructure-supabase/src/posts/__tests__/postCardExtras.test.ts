import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { loadCardExtras } from '../postCardExtras';
import { fail, makeCard, ok } from './cardFixtures';

const POST_ROW = { id: 'post-1', geo_approx: null, source_language: 'he', status_before_removal: null };

describe('loadCardExtras', () => {
  it('reads the posts columns once for the page and skips sources no card can use', async () => {
    const { client, calls } = createFakeClient({ tables: { posts: ok([POST_ROW]) } });

    const extras = await loadCardExtras(client, [makeCard()]);

    expect(extras.get('post-1')).toMatchObject({ sourceLanguage: 'he', challengeId: null, purgeAfter: null, recipient: null });
    expect(callsTo(calls, 'posts')[0]?.filters).toContainEqual(['in', 'id', ['post-1']]);
    expect(callsTo(calls, 'challenges')).toHaveLength(0);
    expect(callsTo(calls, 'post_closures')).toHaveLength(0);
    expect(callsTo(calls, 'post_handoffs')).toHaveLength(0);
  });

  it('finds the challenge, the restore window and the recipient of the cards that have them', async () => {
    const { client } = createFakeClient({
      tables: {
        posts: ok([POST_ROW, { ...POST_ROW, id: 'post-2' }, { ...POST_ROW, id: 'post-3' }]),
        challenges: ok([{ id: 'ch-1', post_id: 'post-1' }]),
        post_closures: ok([{ post_id: 'post-2', purge_after: '2026-02-01T00:00:00Z' }]),
        post_handoffs: ok([
          { post_id: 'post-3', recipient_id: 'u-r', handed_over_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-06T00:00:00Z' },
        ]),
        users: ok([{ id: 'u-r', display_name: 'Ron', avatar_url: null, share_handle: 'ron', verification_level: 1 }]),
      },
    });

    const extras = await loadCardExtras(client, [
      makeCard({ id: 'post-1', post_type: 'challenge' }),
      makeCard({ id: 'post-2', status: 'deleted_no_recipient' }),
      makeCard({ id: 'post-3', status: 'closed_delivered' }),
    ]);

    expect(extras.get('post-1')?.challengeId).toBe('ch-1');
    expect(extras.get('post-2')?.purgeAfter).toBe('2026-02-01T00:00:00Z');
    expect(extras.get('post-3')?.recipient).toEqual({
      recipient: { postId: 'post-3', recipientUserId: 'u-r', markedAt: '2026-01-05T00:00:00Z' },
      user: { userId: 'u-r', displayName: 'Ron', shareHandle: 'ron', avatarUrl: null, verificationLevel: 1 },
    });
  });

  it('gives no recipient when the caller cannot read the handoff', async () => {
    const { client, calls } = createFakeClient({
      tables: { posts: ok([POST_ROW]), post_handoffs: ok([]) },
    });

    const extras = await loadCardExtras(client, [makeCard({ status: 'closed_delivered' })]);

    expect(extras.get('post-1')?.recipient).toBeNull();
    expect(callsTo(calls, 'users')).toHaveLength(0);
  });

  it('returns nothing for an empty page without a call', async () => {
    const { client, calls } = createFakeClient();
    expect((await loadCardExtras(client, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('reports a missing object as unavailable', async () => {
    const { client } = createFakeClient({ tables: { posts: fail('PGRST205', 'no table posts') } });
    await expect(loadCardExtras(client, [makeCard()])).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
