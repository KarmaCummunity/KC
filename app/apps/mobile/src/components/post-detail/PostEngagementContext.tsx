import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PostCommentWithAuthor, PostReactionType } from '@kc/infrastructure-supabase';
import { container } from '../../lib/container';
import { hapticSuccess } from '../../lib/haptics';
import { buildCommentThreads, type PostCommentThreadItem } from './postCommentThread';

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
  const [stats, setStats] = useState({ reactionCount: 0, commentCount: 0 });
  const [activeReaction, setActiveReaction] = useState<PostReactionType | null>(null);
  const [comments, setComments] = useState<PostCommentWithAuthor[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsFailed, setCommentsFailed] = useState(false);

  const refresh = useCallback(async () => {
    // Stats do not depend on the comment list. A failure in either read still
    // rejects; whichever read succeeds still updates its own state.
    const statsPromise = container.postEngagement.getStats(postId).then((s) => {
      if (s) setStats({ reactionCount: s.reactionCount, commentCount: s.commentCount });
    });
    const viewerPromise = viewerId
      ? Promise.all([
          container.postEngagement.listCommentsWithAuthors(postId, 120, viewerId),
          container.postEngagement.getViewerReaction(postId, viewerId),
        ])
          .then(([rows, mine]) => {
            setComments(rows);
            setActiveReaction(mine);
            setCommentsFailed(false);
          })
          .catch(() => {
            setCommentsFailed(true);
          })
          .finally(() => setCommentsLoaded(true))
      : Promise.resolve();
    await Promise.all([statsPromise, viewerPromise]);
  }, [postId, viewerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const visibleCommentCount = commentsLoaded ? comments.length : stats.commentCount;

  const onReaction = useCallback(
    (type: PostReactionType) => {
      if (!viewerId || busy) return;
      void (async () => {
        setBusy(true);
        const previous = activeReaction;
        const next = activeReaction === type ? null : type;
        setActiveReaction(next);
        try {
          await container.postEngagement.setReaction(postId, next);
          if (next !== null) hapticSuccess();
          await refresh();
        } catch {
          setActiveReaction(previous);
        } finally {
          setBusy(false);
        }
      })();
    },
    [viewerId, busy, activeReaction, postId, refresh],
  );

  const onToggleCommentLike = useCallback(
    (commentId: string, liked: boolean) => {
      if (!viewerId || busy) return;
      void (async () => {
        setBusy(true);
        try {
          await container.postEngagement.setCommentLike(commentId, liked);
          if (liked) hapticSuccess();
          await refresh();
        } finally {
          setBusy(false);
        }
      })();
    },
    [viewerId, busy, refresh],
  );

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
