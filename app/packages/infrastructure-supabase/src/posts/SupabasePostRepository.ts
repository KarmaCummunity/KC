// SupabasePostRepository — adapter for IPostRepository over the baseline.
// Mapped to SRS: FR-POST-001..004, FR-POST-008..011, FR-POST-014, FR-FEED-001..005, FR-FEED-013,
// FR-CLOSURE-001..005, FR-PROFILE-001.
//
// Reads return cards (`feed_page`, `profile_posts_page`, `post_cards`); writes are a draft insert
// completed and published by `publish_post`; status moves only through RPCs.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PostError,
  type ClosureCandidate,
  type CreatePostInput,
  type FeedPage,
  type IPostRepository,
  type PostActorIdentityRow,
  type PostFeedFilter,
  type PostWithOwner,
  type ProfileClosedPostsPage,
  type UpdatePostInput,
  type UpsertPostActorIdentityInput,
} from '@kc/application';
import type { Post, PostStatus, PostVisibility, ProfileClosedPostsListMode } from '@kc/domain';
import type { Database } from '../database.types';
import { buildFeedFilters, narrowPage } from './feedFilters';
import { listOwnerPostsPage } from './getMyPostsPage';
import { getProfileClosedPostsHelper } from './getProfileClosedPostsHelper';
import { fetchFeedPage } from './postCardPages';
import { loadPostCatalog } from './postCatalog';
import {
  closePost,
  getClosureCandidates,
  ownerCompleteOffer,
  reopenPost,
  republishPost,
  unmarkRecipientSelf,
} from './closureMethods';
import { listPostActorIdentitiesForPost, upsertPostActorIdentityRow } from './postActorIdentityMethods';
import {
  countOpenByUser,
  countProfileClosedPosts,
  countProfileOpenPosts,
  countProfilePostsForViewer,
  fetchPostDetail,
} from './postRepoQueries';
import { adminRemovePost, createPost, deletePost, updatePost } from './postWriteMethods';

export class SupabasePostRepository implements IPostRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  // ── Feed ────────────────────────────────────────────────────────────────
  // One call returns the cards: `feed_page` ranks, filters and pages them on the server. The viewer
  // is the signed-in caller, so `viewerId` is not sent.
  async getFeed(
    _viewerId: string | null,
    filter: PostFeedFilter,
    limit: number,
    cursor?: string,
  ): Promise<FeedPage> {
    const catalog = await loadPostCatalog(this.client);
    const page = await fetchFeedPage(this.client, buildFeedFilters(filter, catalog), limit, cursor);
    return { posts: narrowPage(page.posts, filter), nextCursor: page.nextCursor };
  }

  // ── Single post ─────────────────────────────────────────────────────────
  // The server masks the poster per viewer, so the identity listing host of the old projection is no longer needed.
  async findById(postId: string): Promise<PostWithOwner | null> {
    return fetchPostDetail(this.client, postId);
  }

  // ── Mutations ───────────────────────────────────────────────────────────
  async create(input: CreatePostInput): Promise<Post> {
    const postId = await createPost(this.client, input);
    const created = await fetchPostDetail(this.client, postId);
    if (!created) throw new PostError('unknown', `create: post ${postId} disappeared after insert`);
    return created;
  }

  async update(postId: string, patch: UpdatePostInput): Promise<Post> {
    await updatePost(this.client, postId, patch);
    const updated = await fetchPostDetail(this.client, postId);
    if (!updated) throw new PostError('not_found', `update: post ${postId} not found`);
    return updated;
  }

  delete(postId: string): Promise<void> {
    return deletePost(this.client, postId);
  }

  adminRemove(postId: string): Promise<void> {
    return adminRemovePost(this.client, postId);
  }

  // ── Closure (FR-CLOSURE-001..005) — delegated to closureMethods ─────────
  close(postId: string, recipientUserId: string | null): Promise<Post> {
    return closePost(this.client, postId, recipientUserId);
  }
  ownerCompleteOffer(
    targetId: string,
    recipientUserId: string | null,
    mode: 'assign' | 'close_without',
  ): Promise<{ closed: boolean }> {
    return ownerCompleteOffer(this.client, targetId, recipientUserId, mode);
  }
  reopen(postId: string): Promise<Post> {
    return reopenPost(this.client, postId);
  }
  republish(postId: string): Promise<string> {
    return republishPost(this.client, postId);
  }
  unmrkRecipientSelf(postId: string): Promise<void> {
    return unmarkRecipientSelf(this.client, postId);
  }
  getClosureCandidates(postId: string): Promise<ClosureCandidate[]> {
    return getClosureCandidates(this.client, postId);
  }

  // ── A member's posts ────────────────────────────────────────────────────
  getMyPosts(
    userId: string,
    status: PostStatus[],
    limit: number,
    cursor?: string,
    visibility?: PostVisibility,
    excludeVisibility?: PostVisibility,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> {
    return listOwnerPostsPage(this.client, userId, { statuses: status, visibility, excludeVisibility }, limit, cursor);
  }

  getProfileClosedPosts(
    profileUserId: string,
    _viewerUserId: string | null,
    limit: number,
    cursor?: string,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<ProfileClosedPostsPage> {
    return getProfileClosedPostsHelper(this.client, profileUserId, limit, cursor, listMode ?? 'standard');
  }

  listPostActorIdentities(postId: string): Promise<PostActorIdentityRow[]> {
    return listPostActorIdentitiesForPost(this.client, postId);
  }

  upsertPostActorIdentity(input: UpsertPostActorIdentityInput): Promise<void> {
    return upsertPostActorIdentityRow(this.client, input);
  }

  // ── Counters ────────────────────────────────────────────────────────────
  countOpenByUser(userId: string): Promise<number> {
    return countOpenByUser(this.client, userId);
  }

  countProfilePostsForViewer(ownerId: string, _viewerId: string | null): Promise<number> {
    return countProfilePostsForViewer(this.client, ownerId);
  }

  countProfileOpenPosts(ownerId: string, options?: { excludeOnlyMe?: boolean }): Promise<number> {
    return countProfileOpenPosts(this.client, ownerId, options);
  }

  countProfileClosedPosts(
    profileUserId: string,
    _viewerUserId: string | null,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<number> {
    return countProfileClosedPosts(this.client, profileUserId, listMode);
  }
}
