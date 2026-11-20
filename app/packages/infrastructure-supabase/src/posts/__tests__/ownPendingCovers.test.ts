import { describe, expect, it, vi } from 'vitest';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { withOwnPendingCovers } from '../ownPendingCovers';
import { cardsToPosts } from '../postCardPages';
import { fail, makeCard, ok, pageTables } from './cardFixtures';

const pendingRow = { id: 'm-own', post_id: 'mine', kind: 'image', storage_bucket: 'post-images', storage_key: 'me/b/0.jpg' };

describe('withOwnPendingCovers', () => {
  it('gives a coverless card the caller-visible first photo, reading only coverless cards', async () => {
    const { client, calls } = createFakeClient({ tables: { post_media: ok([pendingRow]) } });
    const covered = makeCard({ id: 'other' });
    const cards = [covered, makeCard({ id: 'mine', cover_media: null }), makeCard({ id: 'text-only', cover_media: null })];

    const out = await withOwnPendingCovers(client, cards);

    expect(out[0]).toBe(covered);
    expect(out[1]?.cover_media).toEqual({ id: 'm-own', kind: 'image', storage_bucket: 'post-images', storage_key: 'me/b/0.jpg' });
    expect(out[2]?.cover_media).toBeNull();
    const [read] = callsTo(calls, 'post_media');
    expect(read?.filters).toEqual([
      ['in', 'post_id', ['mine', 'text-only']],
      ['eq', 'ordinal', 0],
      ['eq', 'kind', 'image'],
    ]);
  });

  it('makes no query when every card already has its cover', async () => {
    const { client, calls } = createFakeClient();
    const cards = [makeCard({ id: 'a' })];
    await expect(withOwnPendingCovers(client, cards)).resolves.toBe(cards);
    expect(callsTo(calls, 'post_media')).toHaveLength(0);
  });

  it('leaves the cards unchanged when nothing is visible or the read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cards = [makeCard({ id: 'theirs', cover_media: null })];
    const empty = createFakeClient({ tables: { post_media: ok([]) } });
    await expect(withOwnPendingCovers(empty.client, cards)).resolves.toBe(cards);
    const broken = createFakeClient({ tables: { post_media: fail('08006', 'connection refused') } });
    await expect(withOwnPendingCovers(broken.client, cards)).resolves.toBe(cards);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('feeds the owner\'s pending photo into the mapped post as its first media asset', async () => {
    const { client } = createFakeClient({ tables: pageTables({ post_media: ok([pendingRow]) }) });
    const [post] = await cardsToPosts(client, [makeCard({ id: 'mine', cover_media: null })]);
    expect(post?.mediaAssets.map((m) => m.path)).toEqual(['me/b/0.jpg']);
  });
});
