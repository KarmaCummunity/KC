// Picks the newest already-fetched post so detail can render it without a
// second read of the same row. Feed pages store `posts`; closed-profile pages
// store `items`. Both are PostWithOwner from POST_SELECT_OWNER.

export type CachedPostPage<T> = {
  readonly posts?: readonly T[];
  readonly items?: readonly T[];
};

export type CachedPostQuery<T> = {
  readonly pages?: readonly CachedPostPage<T>[];
  readonly updatedAt: number;
};

export type CachedPostSeed<T> = {
  readonly post: T;
  readonly updatedAt: number;
};

export function findNewestCachedPost<T extends { readonly postId: string }>(
  queries: readonly CachedPostQuery<T>[],
  postId: string | undefined,
): CachedPostSeed<T> | undefined {
  if (!postId) return undefined;
  let best: CachedPostSeed<T> | undefined;
  for (const query of queries) {
    if (!query.updatedAt) continue;
    for (const page of query.pages ?? []) {
      const rows = page.posts ?? page.items;
      const post = rows?.find((row) => row.postId === postId);
      if (!post) continue;
      if (!best || query.updatedAt > best.updatedAt) {
        best = { post, updatedAt: query.updatedAt };
      }
    }
  }
  return best;
}
