import { describe, expect, it } from 'vitest';
import type { PostCommentWithAuthor } from '@kc/infrastructure-supabase';
import { buildCommentThreads } from '../postCommentThread';

function comment(overrides: Partial<PostCommentWithAuthor> & Pick<PostCommentWithAuthor, 'commentId'>): PostCommentWithAuthor {
  return {
    postId: 'p1',
    authorId: 'u1',
    parentCommentId: overrides.parentCommentId ?? null,
    body: overrides.body ?? 'text',
    createdAt: '2026-01-01T00:00:00Z',
    authorDisplayName: 'A',
    authorAvatarUrl: null,
    authorShareHandle: 'a',
    likeCount: 0,
    likedByViewer: false,
    ...overrides,
  };
}

describe('buildCommentThreads', () => {
  it('nests replies under top-level comments', () => {
    const flat = [
      comment({ commentId: 'c1', parentCommentId: null }),
      comment({ commentId: 'c2', parentCommentId: 'c1', body: 'reply' }),
      comment({ commentId: 'c3', parentCommentId: null }),
    ];
    const threads = buildCommentThreads(flat);
    expect(threads).toHaveLength(2);
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].commentId).toBe('c2');
  });
});
