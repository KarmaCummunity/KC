// Reactions, comments and comment likes of a post (FR-POST-*, KC#867) over the baseline.
//
// Counters come from `post_stats`; the viewer's reaction is their own `post_reactions` row; a
// reaction is set by `set_post_reaction` and removed by deleting the row. Comments are inserted
// directly (mentions, rate limit and notifications are done by triggers) and listed with
// `post_comments_page`, which returns the author with the poster-anonymity mask already applied.

import type { SupabaseClient } from '@supabase/supabase-js';
import { PostError } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { toPostError } from './postErrors';

export type PostReactionType = 'like' | 'support' | 'thanks';

export type PostEngagementStats = {
  postId: string;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
};

export type PostCommentRow = {
  commentId: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
};

export type PostCommentWithAuthor = PostCommentRow & {
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  authorShareHandle: string | null;
  likeCount: number;
  likedByViewer: boolean;
};

/** Most comments the detail screen loads: root comments, then the replies of those that have any. */
const ROOT_PAGE_MAX = 50;

type CommentPageRow = Database['public']['Functions']['post_comments_page']['Returns'][number];

function toCommentWithAuthor(row: CommentPageRow): PostCommentWithAuthor {
  return {
    commentId: row.id,
    postId: row.post_id,
    // A masked author (FR-POST-021) arrives without id, name, handle and avatar.
    authorId: row.author_id ?? '',
    parentCommentId: row.parent_comment_id,
    body: row.body,
    createdAt: row.created_at,
    authorDisplayName: row.author_display_name,
    authorAvatarUrl: row.author_avatar_url,
    authorShareHandle: row.author_share_handle,
    likeCount: row.reactions_count,
    likedByViewer: row.viewer_reacted,
  };
}

export class SupabasePostEngagementRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** The post's counters; zeros while nobody has reacted, commented or shared (no `post_stats` row yet). */
  async getStats(postId: string): Promise<PostEngagementStats | null> {
    const row = unwrapCall(
      'table:post_stats',
      await this.client
        .from('post_stats')
        .select('reactions_count, comments_count, shares_count')
        .eq('post_id', postId)
        .maybeSingle(),
    );
    return {
      postId,
      reactionCount: row?.reactions_count ?? 0,
      commentCount: row?.comments_count ?? 0,
      shareCount: row?.shares_count ?? 0,
    };
  }

  async getViewerReaction(postId: string, viewerId: string): Promise<PostReactionType | null> {
    const row = unwrapCall(
      'table:post_reactions',
      await this.client
        .from('post_reactions')
        .select('reaction_type')
        .eq('post_id', postId)
        .eq('user_id', viewerId)
        .maybeSingle(),
    );
    return (row?.reaction_type as PostReactionType | undefined) ?? null;
  }

  /** Sets the caller's reaction, or removes it when `reactionType` is null. */
  async setReaction(postId: string, reactionType: PostReactionType | null): Promise<void> {
    try {
      if (reactionType === null) {
        unwrapCall('table:post_reactions', await this.client.from('post_reactions').delete().eq('post_id', postId));
        return;
      }
      unwrapCall(
        'rpc:set_post_reaction',
        await this.client.rpc('set_post_reaction', { p_post_id: postId, p_reaction_type: reactionType }),
      );
    } catch (error) {
      throw toPostError(error);
    }
  }

  async createComment(postId: string, body: string, parentCommentId?: string | null): Promise<PostCommentRow> {
    const authorId = await sessionUserId(this.client);
    if (!authorId) throw new PostError('forbidden', 'createComment: not signed in');
    try {
      const row = unwrapCall(
        'table:post_comments',
        await this.client
          .from('post_comments')
          .insert({ post_id: postId, author_id: authorId, parent_comment_id: parentCommentId ?? null, body })
          .select('id, post_id, author_id, parent_comment_id, body, created_at')
          .single(),
      );
      if (!row) throw new PostError('unknown', 'createComment: no row returned');
      return {
        commentId: row.id,
        postId: row.post_id,
        authorId: row.author_id,
        parentCommentId: row.parent_comment_id,
        body: row.body,
        createdAt: row.created_at,
      };
    } catch (error) {
      throw toPostError(error);
    }
  }

  /** Likes (`liked`) or unlikes a comment; liking twice is not an error. */
  async setCommentLike(commentId: string, liked: boolean): Promise<void> {
    const userId = await sessionUserId(this.client);
    if (!userId) throw new PostError('forbidden', 'setCommentLike: not signed in');
    if (!liked) {
      unwrapCall(
        'table:post_comment_reactions',
        await this.client.from('post_comment_reactions').delete().eq('comment_id', commentId).eq('user_id', userId),
      );
      return;
    }
    unwrapCall(
      'table:post_comment_reactions',
      await this.client
        .from('post_comment_reactions')
        .upsert({ comment_id: commentId, user_id: userId }, { onConflict: 'comment_id,user_id', ignoreDuplicates: true }),
    );
  }

  private async commentsPage(postId: string, parentCommentId: string | null, limit: number) {
    const rows = unwrapCall(
      'rpc:post_comments_page',
      await this.client.rpc('post_comments_page', {
        p_post_id: postId,
        p_parent_comment_id: parentCommentId ?? undefined,
        p_limit: limit,
      }),
    );
    return rows ?? [];
  }

  /**
   * Root comments and their replies, oldest first, each with its author (anonymous when the poster asked
   * for it), like count and whether the caller liked it. At most `limit` comments are returned, but never
   * more than one page of root comments: replies are read for the roots that have any.
   */
  async listCommentsWithAuthors(postId: string, limit = 120): Promise<PostCommentWithAuthor[]> {
    const roots = await this.commentsPage(postId, null, Math.min(limit, ROOT_PAGE_MAX));
    const withReplies = roots.filter((root) => root.replies_count > 0);
    const replyPages = await Promise.all(withReplies.map((root) => this.commentsPage(postId, root.id, ROOT_PAGE_MAX)));
    const byParent = new Map(withReplies.map((root, index) => [root.id, replyPages[index] ?? []]));
    return roots.flatMap((root) => [root, ...(byParent.get(root.id) ?? [])]).slice(0, limit).map(toCommentWithAuthor);
  }
}
