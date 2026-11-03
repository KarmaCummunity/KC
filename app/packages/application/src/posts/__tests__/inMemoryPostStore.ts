// Shared state behind InMemoryPostRepository instances (G39 contract fake).
// One store plays the database; one repository per actor plays an RLS-scoped
// client, exactly like one SupabasePostRepository per signed-in user.

import type { Post } from '@kc/domain';
import type { PostWithOwner } from '../../ports/IPostRepository';
import type { PostActorIdentityRow } from '../../ports/postActorIdentity';

export interface InMemoryUser {
  readonly userId: string;
  readonly displayName: string;
  readonly shareHandle: string;
  readonly privacyMode: 'Public' | 'Private';
}

/** One `saved_posts` row (FR-POST-022): a user's bookmark on a post. */
export interface InMemorySavedPost {
  readonly userId: string;
  readonly postId: string;
  readonly savedAt: string;
}

export class InMemoryPostStore {
  readonly users = new Map<string, InMemoryUser>();
  readonly posts = new Map<string, Post>();
  readonly actorIdentities = new Map<string, PostActorIdentityRow>();
  /** Bookmarks keyed by `savedKey(userId, postId)` — the table's primary key. */
  readonly savedPosts = new Map<string, InMemorySavedPost>();
  /** Known city ids — the `cities` lookup table the posts FK points at. */
  readonly cities: ReadonlySet<string>;
  private lastTickMs = 0;

  constructor(options: { cities: readonly string[] }) {
    this.cities = new Set(options.cities);
  }

  addUser(overrides: Partial<InMemoryUser> = {}): InMemoryUser {
    const userId = overrides.userId ?? crypto.randomUUID();
    const user: InMemoryUser = {
      userId,
      displayName: overrides.displayName ?? `user ${userId.slice(0, 6)}`,
      shareHandle: overrides.shareHandle ?? `u_${userId.slice(0, 8)}`,
      privacyMode: overrides.privacyMode ?? 'Public',
    };
    this.users.set(userId, user);
    return user;
  }

  /** Removes a post and, like the table's `on delete cascade`, every bookmark on it. */
  removePost(postId: string): void {
    this.posts.delete(postId);
    for (const [key, row] of this.savedPosts) {
      if (row.postId === postId) this.savedPosts.delete(key);
    }
  }

  /** Strictly increasing timestamps, so `created_at` ordering is total as with Postgres' clock. */
  now(): string {
    this.lastTickMs = Math.max(Date.now(), this.lastTickMs + 1);
    return new Date(this.lastTickMs).toISOString();
  }

  /** Joins the owner the way the adapter's `POST_SELECT_OWNER` projection does. */
  withOwner(post: Post): PostWithOwner {
    const owner = this.users.get(post.ownerId);
    return {
      ...clonePost(post),
      ownerName: owner?.displayName ?? null,
      ownerAvatarUrl: null,
      ownerHandle: owner?.shareHandle ?? '',
      ownerPrivacyMode: owner?.privacyMode ?? 'Public',
      recipientUser: null,
      distanceKm: null,
    };
  }
}

/** Repositories hand out copies: a caller mutating a returned Post must not change the store. */
export function clonePost(post: Post): Post {
  return structuredClone(post);
}

export function identityKey(postId: string, userId: string): string {
  return `${postId}:${userId}`;
}

export function savedKey(userId: string, postId: string): string {
  return `${userId}:${postId}`;
}

const HIDDEN_FROM_OTHERS: ReadonlySet<Post['status']> = new Set(['removed_admin', 'deleted_no_recipient', 'expired']);

/**
 * The slice of `is_post_visible_to` the contract fakes model: the owner always reads
 * their post; closed-without-recipient, expired and admin-removed posts and OnlyMe posts
 * are hidden from everyone else. Blocks, hides, follower checks and the closed-delivered
 * participant rules are not modelled.
 */
export function isPostVisibleTo(post: Post, viewerId: string | null): boolean {
  if (viewerId === post.ownerId) return true;
  if (HIDDEN_FROM_OTHERS.has(post.status)) return false;
  return post.visibility !== 'OnlyMe';
}
