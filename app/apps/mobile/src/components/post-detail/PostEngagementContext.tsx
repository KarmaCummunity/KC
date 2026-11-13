import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PostReactionType } from '@kc/infrastructure-supabase';
import { container } from '../../lib/container';
import { hapticSuccess } from '../../lib/haptics';
import { buildCommentThreads, type PostCommentThreadItem } from './postCommentThread';
import { usePostEngagementSnapshot, withCommentLike, withReaction } from '../../hooks/usePostEngagementSnapshot';

type ReplyTarget = { commentId: string; authorLabel: string };

type PostEngagementContextValue = {
  readonly stats: { reactionCount: number; commentCount: number };
  readonly activeReaction: PostReactionType | null;
  readonly threads: readonly PostCommentThreadItem[];
  readonly busy: boolean;
  readonly draft: string;
  readonly replyTo: ReplyTarget | null;
  readonly commentsLoaded: boolean;
  readonly commentsFailed: boolean;
  /** Count that matches the list on screen (not the denormalized counter once loaded). */
  readonly visibleCommentCount: number;
  setDraft: (text: string) => void;
  clearReply: () => void;
  onReaction: (type: PostReactionType) => void;
  onReply: (target: ReplyTarget) => void;
  onToggleCommentLike: (commentId: string, liked: boolean) => void;
  onSubmitComment: () => void;
};

const PostEngagementContext = createContext<PostEngagementContextValue | null>(null);

export function usePostEngagement(): PostEngagementContextValue | null {
  return useContext(PostEngagementContext);
}

type ProviderProps = Readonly<{
  postId: string;
  viewerId: string | null;
  children: React.ReactNode;
}>;

export function PostEngagementProvider({ postId, viewerId, children }: ProviderProps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // Cached per post and viewer: a reopened post shows its thread at once and refreshes behind it.
  const { snapshot, loaded, refresh, patch, restore } = usePostEngagementSnapshot(postId, viewerId);
  const { stats, activeReaction, comments, commentsFailed } = snapshot;
  // Comments are only read for a signed-in viewer; a guest keeps the denormalized counter.
  const commentsLoaded = loaded && viewerId !== null;

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const visibleCommentCount = commentsLoaded ? comments.length : stats.commentCount;

  // Reactions and comment likes are optimistic: the snapshot changes on the tap, the write runs,
  // and the server state is re-read in the background. A failed write restores the snapshot.
  const onReaction = useCallback(
    (type: PostReactionType) => {
      if (!viewerId || busy) return;
      const next = activeReaction === type ? null : type;
      const previous = patch((current) => withReaction(current, next));
      setBusy(true);
      void container.postEngagement
        .setReaction(postId, next)
        .then(() => {
          if (next !== null) hapticSuccess();
          void refresh();
        })
        .catch(() => restore(previous))
        .finally(() => setBusy(false));
    },
    [viewerId, busy, activeReaction, postId, patch, restore, refresh],
  );

  const onToggleCommentLike = useCallback(
    (commentId: string, liked: boolean) => {
      if (!viewerId || busy) return;
      const previous = patch((current) => withCommentLike(current, commentId, liked));
      setBusy(true);
      void container.postEngagement
        .setCommentLike(commentId, liked)
        .then(() => {
          if (liked) hapticSuccess();
          void refresh();
        })
        .catch(() => restore(previous))
        .finally(() => setBusy(false));
    },
    [viewerId, busy, patch, restore, refresh],
  );

  // A new comment needs its server row (id, author, time), so the composer stays busy until the
  // thread has been re-read and the comment is on screen.
  const onSubmitComment = useCallback(() => {
    const body = draft.trim();
    if (!viewerId || !body || busy) return;
    void (async () => {
      setBusy(true);
      try {
        await container.postEngagement.createComment(postId, body, replyTo?.commentId ?? null);
        hapticSuccess();
        setDraft('');
        setReplyTo(null);
        await refresh();
      } finally {
        setBusy(false);
      }
    })();
  }, [draft, viewerId, busy, postId, replyTo, refresh]);

  const value = useMemo(
    (): PostEngagementContextValue => ({
      stats,
      activeReaction,
      threads,
      busy,
      draft,
      replyTo,
      commentsLoaded,
      commentsFailed,
      visibleCommentCount,
      setDraft,
      clearReply: () => setReplyTo(null),
      onReaction,
      onReply: (target) => setReplyTo(target),
      onToggleCommentLike,
      onSubmitComment,
    }),
    [stats, activeReaction, threads, busy, draft, replyTo, commentsLoaded, commentsFailed, visibleCommentCount, onReaction, onToggleCommentLike, onSubmitComment],
  );

  if (!viewerId) {
    return <PostEngagementContext.Provider value={null}>{children}</PostEngagementContext.Provider>;
  }

  return <PostEngagementContext.Provider value={value}>{children}</PostEngagementContext.Provider>;
}
