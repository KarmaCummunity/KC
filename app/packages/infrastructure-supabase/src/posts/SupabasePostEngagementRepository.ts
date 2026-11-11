// KC#867 — post reactions/comments/shares via SECURITY INVOKER RPCs.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';

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

export class SupabasePostEngagementRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getStats(postId: string): Promise<PostEngagementStats | null> {
    const { data, error } = await this.client.rpc(
      'rpc_get_post_engagement_stats' as never,
      { p_post_id: postId } as never,
    );
    if (error) throw error;
    const row = data as {
      post_id: string;
      reaction_count: number;
      comment_count: number;
      share_count: number;
    } | null;
    if (!row) return null;
    return {
      postId: row.post_id,
      reactionCount: row.reaction_count,
      commentCount: row.comment_count,
      shareCount: row.share_count,
    };
  }

  async getViewerReaction(postId: string, viewerId: string): Promise<PostReactionType | null> {
    const { data, error } = await this.client
      .from('post_reactions' as never)
      .select('reaction_type')
      .eq('post_id', postId)
      .eq('user_id', viewerId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { reaction_type: PostReactionType } | null;
    return row?.reaction_type ?? null;
  }

  async setReaction(postId: string, reactionType: PostReactionType | null): Promise<void> {
    const { error } = await this.client.rpc(
      'rpc_set_post_reaction' as never,
      { p_post_id: postId, p_reaction_type: reactionType } as never,
    );
    if (error) throw error;
  }

  async createComment(
    postId: string,
    body: string,
    parentCommentId?: string | null,
  ): Promise<PostCommentRow> {
    const { data, error } = await this.client.rpc(
      'rpc_create_post_comment' as never,
      {
        p_post_id: postId,
        p_body: body,
        p_parent_comment_id: parentCommentId ?? null,
      } as never,
    );
    if (error) throw error;
    const row = data as {
      comment_id: string;
      post_id: string;
      author_id: string;
      parent_comment_id: string | null;
      body: string;
      created_at: string;
    };
    return {
      commentId: row.comment_id,
      postId: row.post_id,
      authorId: row.author_id,
      parentCommentId: row.parent_comment_id,
      body: row.body,
      createdAt: row.created_at,
    };
  }

  async setCommentLike(commentId: string, liked: boolean): Promise<void> {
    const { error } = await this.client.rpc(
      'rpc_set_post_comment_like' as never,
      { p_comment_id: commentId, p_liked: liked } as never,
    );
    if (error) throw error;
  }

  async listComments(postId: string, limit = 40): Promise<PostCommentRow[]> {
    const { data, error } = await this.client
      .from('post_comments' as never)
      .select('comment_id, post_id, author_id, parent_comment_id, body, created_at')
      .eq('post_id', postId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    type CommentRow = {
      comment_id: string;
      post_id: string;
      author_id: string;
      parent_comment_id: string | null;
      body: string;
      created_at: string;
    };
    const rows = (data ?? []) as CommentRow[];
    return rows.map((row) => ({
      commentId: row.comment_id,
      postId: row.post_id,
      authorId: row.author_id,
      parentCommentId: row.parent_comment_id,
      body: row.body,
      createdAt: row.created_at,
    }));
  }

  async listCommentsWithAuthors(
    postId: string,
    limit = 120,
    viewerId: string | null,
  ): Promise<PostCommentWithAuthor[]> {
    const embedded = await this.client
      .from('post_comments' as never)
      .select(
        `comment_id, post_id, author_id, parent_comment_id, body, created_at,
        author:users!post_comments_author_id_fkey(display_name, avatar_url, share_handle)`,
      )
      .eq('post_id', postId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(limit);

    type CommentRow = {
      comment_id: string;
      post_id: string;
      author_id: string;
      parent_comment_id: string | null;
      body: string;
      created_at: string;
      author?: { display_name: string | null; avatar_url: string | null; share_handle: string | null } | null;
    };

    let rows: CommentRow[];
    if (embedded.error) {
      const plain = await this.listComments(postId, limit);
      rows = plain.map((c) => ({
        comment_id: c.commentId,
        post_id: c.postId,
        author_id: c.authorId,
        parent_comment_id: c.parentCommentId,
        body: c.body,
        created_at: c.createdAt,
        author: null,
      }));
    } else {
      rows = (embedded.data ?? []) as CommentRow[];
    }
    if (rows.length === 0) return [];

    const commentIds = rows.map((r) => r.comment_id);
    // Likes are optional until migration 0641 is applied; a missing table must not hide comments.
    const { data: likeRows } = await this.client
      .from('post_comment_reactions' as never)
      .select('comment_id, user_id')
      .in('comment_id', commentIds);

    const likeCounts = new Map<string, number>();
    const viewerLikes = new Set<string>();
    for (const lr of (likeRows ?? []) as { comment_id: string; user_id: string }[]) {
      likeCounts.set(lr.comment_id, (likeCounts.get(lr.comment_id) ?? 0) + 1);
      if (viewerId && lr.user_id === viewerId) viewerLikes.add(lr.comment_id);
    }

    return rows.map((row) => ({
      commentId: row.comment_id,
      postId: row.post_id,
      authorId: row.author_id,
      parentCommentId: row.parent_comment_id,
      body: row.body,
      createdAt: row.created_at,
      authorDisplayName: row.author?.display_name ?? null,
      authorAvatarUrl: row.author?.avatar_url ?? null,
      authorShareHandle: row.author?.share_handle ?? null,
      likeCount: likeCounts.get(row.comment_id) ?? 0,
      likedByViewer: viewerLikes.has(row.comment_id),
    }));
  }
}
