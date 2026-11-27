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

/** Reactions and comments on a post. */
export interface IPostEngagementRepository {
  /** Reaction, comment and share counts of a post; null when the caller cannot see it. */
  getStats(postId: string): Promise<PostEngagementStats | null>;
  getViewerReaction(postId: string, viewerId: string): Promise<PostReactionType | null>;
  /** Sets, changes or (with null) clears the caller's reaction. */
  setReaction(postId: string, reactionType: PostReactionType | null): Promise<void>;
  createComment(postId: string, body: string, parentCommentId?: string | null): Promise<PostCommentRow>;
  setCommentLike(commentId: string, liked: boolean): Promise<void>;
  /** Root comments, then the replies of those that have any, each with its author. */
  listCommentsWithAuthors(postId: string, limit?: number): Promise<PostCommentWithAuthor[]>;
}
