// The likes and comments of one post as a cached snapshot (React Query).
//
// The snapshot is kept per post and viewer, so reopening a post paints its counters, the viewer's
// own reaction and the comment thread at once and refreshes them in the background. Writes patch
// the snapshot first (optimistic) and confirm with a background refresh, so a tap never waits on
// three reads.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PostCommentWithAuthor, PostReactionType } from '@kc/infrastructure-supabase';
import { container } from '../lib/container';

/** Most comments the detail screen loads in one read. */
const COMMENT_PAGE_SIZE = 120;

export interface PostEngagementSnapshot {
  readonly stats: { readonly reactionCount: number; readonly commentCount: number };
  readonly activeReaction: PostReactionType | null;
  readonly comments: readonly PostCommentWithAuthor[];
  /** True when the last comments read failed; the previous comments stay on screen. */
  readonly commentsFailed: boolean;
}

const EMPTY_SNAPSHOT: PostEngagementSnapshot = {
  stats: { reactionCount: 0, commentCount: 0 },
  activeReaction: null,
  comments: [],
  commentsFailed: false,
};

export const postEngagementQueryKey = (postId: string, viewerId: string | null) =>
  ['post-engagement', postId, viewerId] as const;

/** The viewer's own reaction and the thread; null when the read failed (stats are independent). */
async function readViewerSlice(postId: string, viewerId: string) {
  try {
    const [comments, activeReaction] = await Promise.all([
      container.postEngagement.listCommentsWithAuthors(postId, COMMENT_PAGE_SIZE),
      container.postEngagement.getViewerReaction(postId, viewerId),
    ]);
    return { comments, activeReaction };
  } catch {
    return null;
  }
}

/** Snapshot after the viewer toggles `type`: the reaction and its counter move together. */
export function withReaction(snapshot: PostEngagementSnapshot, next: PostReactionType | null): PostEngagementSnapshot {
  const delta = Number(next !== null) - Number(snapshot.activeReaction !== null);
  return {
    ...snapshot,
    activeReaction: next,
    stats: { ...snapshot.stats, reactionCount: Math.max(0, snapshot.stats.reactionCount + delta) },
  };
}

/** Snapshot after the viewer likes or unlikes one comment. */
export function withCommentLike(snapshot: PostEngagementSnapshot, commentId: string, liked: boolean): PostEngagementSnapshot {
  return {
    ...snapshot,
    comments: snapshot.comments.map((comment) => {
      if (comment.commentId !== commentId || comment.likedByViewer === liked) return comment;
      return { ...comment, likedByViewer: liked, likeCount: Math.max(0, comment.likeCount + (liked ? 1 : -1)) };
    }),
  };
}

export function usePostEngagementSnapshot(postId: string, viewerId: string | null) {
  const queryClient = useQueryClient();
  // Memoized so the callbacks below keep their identity between renders.
  const queryKey = useMemo(() => postEngagementQueryKey(postId, viewerId), [postId, viewerId]);

  const query = useQuery({
    queryKey,
    // Always refresh in the background; the cached snapshot is what makes a reopen instant.
    staleTime: 0,
    queryFn: async (): Promise<PostEngagementSnapshot> => {
      const previous = queryClient.getQueryData<PostEngagementSnapshot>(queryKey) ?? EMPTY_SNAPSHOT;
      const [stats, viewerSlice] = await Promise.all([
        container.postEngagement.getStats(postId),
        viewerId ? readViewerSlice(postId, viewerId) : Promise.resolve(null),
      ]);
      return {
        stats: stats ? { reactionCount: stats.reactionCount, commentCount: stats.commentCount } : previous.stats,
        activeReaction: viewerSlice ? viewerSlice.activeReaction : previous.activeReaction,
        comments: viewerSlice ? viewerSlice.comments : previous.comments,
        commentsFailed: viewerId !== null && viewerSlice === null,
      };
    },
  });

  /** Applies `patch` to the cached snapshot and returns the snapshot it replaced (for rollback). */
  const patch = useCallback(
    (apply: (snapshot: PostEngagementSnapshot) => PostEngagementSnapshot): PostEngagementSnapshot => {
      const previous = queryClient.getQueryData<PostEngagementSnapshot>(queryKey) ?? EMPTY_SNAPSHOT;
      queryClient.setQueryData<PostEngagementSnapshot>(queryKey, apply(previous));
      return previous;
    },
    [queryClient, queryKey],
  );

  const restore = useCallback(
    (snapshot: PostEngagementSnapshot) => queryClient.setQueryData<PostEngagementSnapshot>(queryKey, snapshot),
    [queryClient, queryKey],
  );

  return {
    snapshot: query.data ?? EMPTY_SNAPSHOT,
    /** False until the first read (or a cached snapshot) is available. */
    loaded: query.data !== undefined,
    refresh: query.refetch,
    patch,
    restore,
  };
}
