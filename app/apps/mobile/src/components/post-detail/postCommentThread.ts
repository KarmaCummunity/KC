import type { PostCommentWithAuthor } from '@kc/infrastructure-supabase';

export type PostCommentThreadItem = PostCommentWithAuthor & {
  readonly replies: readonly PostCommentWithAuthor[];
};

export function buildCommentThreads(flat: readonly PostCommentWithAuthor[]): PostCommentThreadItem[] {
  const byParent = new Map<string, PostCommentWithAuthor[]>();
  const roots: PostCommentWithAuthor[] = [];
  for (const c of flat) {
    if (c.parentCommentId == null) roots.push(c);
    else {
      const list = byParent.get(c.parentCommentId) ?? [];
      list.push(c);
      byParent.set(c.parentCommentId, list);
    }
  }
  return roots.map((root) => ({
    ...root,
    replies: byParent.get(root.commentId) ?? [],
  }));
}
