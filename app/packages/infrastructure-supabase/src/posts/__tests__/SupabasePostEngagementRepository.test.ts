import { describe, expect, it } from 'vitest';
import { PostError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { SupabasePostEngagementRepository } from '../SupabasePostEngagementRepository';
import { fail, ok } from './cardFixtures';

const commentRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  post_id: 'p1',
  parent_comment_id: null,
  author_id: 'a1',
  author_display_name: 'Alma',
  author_share_handle: 'alma',
  author_avatar_url: null,
  author_identity_masked: false,
  body: `body ${id}`,
  mention_user_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  edited_at: null,
  reactions_count: 2,
  replies_count: 0,
  viewer_reacted: true,
  next_cursor: {},
  ...over,
});

describe('getStats / getViewerReaction', () => {
  it('reads the counters of the post, zeros before the first interaction', async () => {
    const present = createFakeClient({
      tables: { post_stats: ok({ reactions_count: 3, comments_count: 2, shares_count: 1 }) },
    });
    expect(await new SupabasePostEngagementRepository(present.client).getStats('p1')).toEqual({
      postId: 'p1', reactionCount: 3, commentCount: 2, shareCount: 1,
    });

    const none = createFakeClient({ tables: { post_stats: ok(null) } });
    expect(await new SupabasePostEngagementRepository(none.client).getStats('p1')).toMatchObject({
      reactionCount: 0, commentCount: 0, shareCount: 0,
    });
  });

  it('reads the viewer\'s reaction', async () => {
    const { client, calls } = createFakeClient({ tables: { post_reactions: ok({ reaction_type: 'support' }) } });

    expect(await new SupabasePostEngagementRepository(client).getViewerReaction('p1', 'u1')).toBe('support');
    expect(callsTo(calls, 'post_reactions')[0]?.filters).toEqual(
      expect.arrayContaining([['eq', 'post_id', 'p1'], ['eq', 'user_id', 'u1']]),
    );
  });

  it('reports a missing table as unavailable', async () => {
    const { client } = createFakeClient({ tables: { post_stats: fail('PGRST205', 'no table') } });
    await expect(new SupabasePostEngagementRepository(client).getStats('p1')).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('setReaction', () => {
  it('sets a reaction through the RPC and removes it by deleting the row', async () => {
    const { client, calls } = createFakeClient({
      rpc: { set_post_reaction: ok('like') },
      tables: { post_reactions: ok(null) },
    });
    const repo = new SupabasePostEngagementRepository(client);

    await repo.setReaction('p1', 'like');
    await repo.setReaction('p1', null);

    expect(callsTo(calls, 'set_post_reaction')[0]?.args).toEqual({ p_post_id: 'p1', p_reaction_type: 'like' });
    expect(callsTo(calls, 'post_reactions')[0]?.kind).toBe('delete');
  });

  it('maps a refusal to a post error', async () => {
    const { client } = createFakeClient({ rpc: { set_post_reaction: fail('P0001', 'post_not_found') } });
    await expect(new SupabasePostEngagementRepository(client).setReaction('p1', 'like')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('createComment / setCommentLike', () => {
  it('inserts the comment as the signed-in member and returns it', async () => {
    const { client, calls } = createFakeClient({
      userId: 'u1',
      tables: {
        post_comments: ok({
          id: 'c1', post_id: 'p1', author_id: 'u1', parent_comment_id: 'c0', body: 'hi', created_at: '2026-01-01T00:00:00Z',
        }),
      },
    });

    const created = await new SupabasePostEngagementRepository(client).createComment('p1', 'hi', 'c0');

    expect(callsTo(calls, 'post_comments')[0]?.payload).toEqual({
      post_id: 'p1', author_id: 'u1', parent_comment_id: 'c0', body: 'hi',
    });
    expect(created).toEqual({
      commentId: 'c1', postId: 'p1', authorId: 'u1', parentCommentId: 'c0', body: 'hi', createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('needs a signed-in member and maps a refused comment', async () => {
    const signedOut = createFakeClient({ userId: null });
    await expect(new SupabasePostEngagementRepository(signedOut.client).createComment('p1', 'hi')).rejects.toBeInstanceOf(PostError);

    const refused = createFakeClient({ userId: 'u1', tables: { post_comments: fail('P0001', 'comment_parent_invalid') } });
    await expect(new SupabasePostEngagementRepository(refused.client).createComment('p1', 'hi', 'bad')).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('likes ignoring duplicates and unlikes by deleting the caller\'s row', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1', tables: { post_comment_reactions: ok(null) } });
    const repo = new SupabasePostEngagementRepository(client);

    await repo.setCommentLike('c1', true);
    await repo.setCommentLike('c1', false);

    const [like, unlike] = callsTo(calls, 'post_comment_reactions') as [FakeCall, FakeCall];
    expect(like.kind).toBe('upsert');
    expect(like.payload).toEqual({ comment_id: 'c1', user_id: 'u1' });
    expect(unlike.kind).toBe('delete');
    expect(unlike.filters).toEqual(expect.arrayContaining([['eq', 'comment_id', 'c1'], ['eq', 'user_id', 'u1']]));
  });
});

describe('listCommentsWithAuthors', () => {
  it('returns the roots with their replies, oldest first, with the server-masked author', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        post_comments_page: (call: FakeCall) => {
          const parent = (call.args as { p_parent_comment_id?: string }).p_parent_comment_id;
          if (parent === 'c1') return ok([commentRow('r1', { parent_comment_id: 'c1', author_id: null, author_display_name: null, author_identity_masked: true })]);
          return ok([commentRow('c1', { replies_count: 1 }), commentRow('c2')]);
        },
      },
    });

    const list = await new SupabasePostEngagementRepository(client).listCommentsWithAuthors('p1', 120);

    expect(list.map((c) => c.commentId)).toEqual(['c1', 'r1', 'c2']);
    expect(list[1]).toMatchObject({ authorId: '', authorDisplayName: null, parentCommentId: 'c1' });
    expect(list[0]).toMatchObject({ authorDisplayName: 'Alma', likeCount: 2, likedByViewer: true });
    expect(callsTo(calls, 'post_comments_page')).toHaveLength(2);
  });

  it('caps the list at the requested size', async () => {
    const { client } = createFakeClient({ rpc: { post_comments_page: ok([commentRow('c1'), commentRow('c2'), commentRow('c3')]) } });
    expect(await new SupabasePostEngagementRepository(client).listCommentsWithAuthors('p1', 2)).toHaveLength(2);
  });
});
