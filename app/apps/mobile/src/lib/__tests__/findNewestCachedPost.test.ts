import { describe, expect, it } from 'vitest';
import { findNewestCachedPost } from '../findNewestCachedPost';

const post = (postId: string) => ({ postId, title: postId });

describe('findNewestCachedPost', () => {
  it('returns the copy from the newest cache that contains the post', () => {
    const older = post('p1');
    const newer = { postId: 'p1', title: 'fresh' };
    const found = findNewestCachedPost(
      [
        { pages: [{ posts: [older] }], updatedAt: 1_000 },
        { pages: [{ posts: [newer, post('p2')] }], updatedAt: 5_000 },
      ],
      'p1',
    );
    expect(found).toEqual({ post: newer, updatedAt: 5_000 });
  });

  it('reads profile pages that store posts on items', () => {
    const closed = post('closed');
    const found = findNewestCachedPost(
      [{ pages: [{ items: [closed] }], updatedAt: 20 }],
      'closed',
    );
    expect(found).toEqual({ post: closed, updatedAt: 20 });
  });

  it('ignores caches with no timestamp and unknown ids', () => {
    expect(
      findNewestCachedPost([{ pages: [{ posts: [post('p1')] }], updatedAt: 0 }], 'p1'),
    ).toBeUndefined();
    expect(findNewestCachedPost([{ pages: [{ posts: [post('p1')] }], updatedAt: 10 }], 'missing')).toBeUndefined();
    expect(findNewestCachedPost([], undefined)).toBeUndefined();
  });
});
