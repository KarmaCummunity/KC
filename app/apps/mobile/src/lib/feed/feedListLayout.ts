import type { PostWithOwner } from '@kc/application';

export const FEED_MATCHES_EVERY_N_POSTS = 16;

export type FeedListEntry =
  | { readonly kind: 'postRow'; readonly left: PostWithOwner; readonly right: PostWithOwner | null; readonly key: string }
  | { readonly kind: 'matches'; readonly key: string };

/** Two-column grid rows with a full-width matches strip every N posts (after the first N, 2N, …). */
export function buildFeedListEntries(posts: readonly PostWithOwner[], matchesEvery: number): FeedListEntry[] {
  // No phantom "matches-start" row — FlatList must see length 0 so ListEmptyComponent shows (FR-FEED-008).
  if (posts.length === 0) return [];

  if (matchesEvery <= 0) {
    return chunkPostPairs(posts).map((pair) => ({
      kind: 'postRow' as const,
      left: pair[0],
      right: pair[1] ?? null,
      key: `row-${pair[0].postId}`,
    }));
  }

  // Matches strips only after real posts — never as the first row (avoid an empty strip or a “people” feed).
  const out: FeedListEntry[] = [];
  let seen = 0;
  for (let i = 0; i < posts.length; i += 2) {
    if (seen > 0 && seen % matchesEvery === 0) {
      out.push({ kind: 'matches', key: `matches-after-${seen}` });
    }
    const left = posts[i];
    const right = posts[i + 1] ?? null;
    out.push({ kind: 'postRow', left, right, key: `row-${left.postId}` });
    seen += right ? 2 : 1;
  }
  return out;
}

function chunkPostPairs(posts: readonly PostWithOwner[]): PostWithOwner[][] {
  const pairs: PostWithOwner[][] = [];
  for (let i = 0; i < posts.length; i += 2) {
    pairs.push([posts[i], posts[i + 1]].filter(Boolean) as PostWithOwner[]);
  }
  return pairs;
}
