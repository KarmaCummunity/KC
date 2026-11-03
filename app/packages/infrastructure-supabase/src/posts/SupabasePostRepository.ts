// SupabasePostRepository — adapter for IPostRepository.
// Mapped to SRS: FR-POST-001..004, FR-POST-008..011, FR-POST-014, FR-FEED-001..005, FR-FEED-013, FR-CLOSURE-001..005.

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
  type UpdatePostInput,
  type UpsertPostActorIdentityInput,
} from '@kc/application';
import type {
  Post,
  PostStatus,
  PostVisibility,
  ProfileClosedPostsItem,
  ProfileClosedPostsListMode,
} from '@kc/domain';
import type { Database } from '../database.types';
import { POST_SELECT_OWNER, mapPostWithOwnerRow, type PostWithOwnerJoinedRow } from './mapPostRow';
import { mapInsertError } from './mapInsertError';
import { encodeCursor } from './cursor';
import { runSimpleFeedQuery } from './feedQuery';
import { fetchRankedFeedPage, needsRankedPath } from './feedQueryRanked';
import {
  closePost as closePostHelper,
  reopenPost as reopenPostHelper,
  republishPost as republishPostHelper,
  getClosureCandidates as getClosureCandidatesHelper,
} from './closureMethods';
import { executePostUpdate } from './executePostUpdate';
import { getProfileClosedPostsHelper } from './getProfileClosedPostsHelper';
import { applyPostActorIdentityProjectionBatch } from './applyPostActorIdentityProjection';
import {
  listPostActorIdentitiesForPost,
  upsertPostActorIdentityRow,
} from './postActorIdentityMethods';
import { getMyPostsPage } from './getMyPostsPage';
import {
  countOpenByUser as countOpenByUserQuery,
  countProfileClosedPosts as countProfileClosedPostsQuery,
  countProfileOpenPosts as countProfileOpenPostsQuery,
  countProfilePostsForViewer as countProfilePostsForViewerQuery,
  fetchPostById,
} from './postRepoQueries';

const FEED_HARD_MAX = 100;

export class SupabasePostRepository implements IPostRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  // ── Feed ────────────────────────────────────────────────────────────────
  // Two paths:
  //   - Ranked (distance sort OR radius filter): server RPC `feed_ranked_ids`
  //     returns ordered post_ids + distance_km; adapter fetches full rows by
  //     IN(...) and preserves order.
  //   - Simple (newest/oldest, equality filters only): PostgREST select-builder
  //     with a (created_at, post_id) keyset cursor; signed-in viewers read the
  //     feed_visible_posts view so hides/mutes apply.
  async getFeed(
    viewerId: string | null,
    filter: PostFeedFilter,
    limit: number,
    cursor?: string,
  ): Promise<FeedPage> {
    const safeLimit = Math.max(1, Math.min(limit, FEED_HARD_MAX));

    if (needsRankedPath(filter)) {
      return fetchRankedFeedPage(this.client, viewerId, filter, cursor, safeLimit);
    }

    const { data, error } = await runSimpleFeedQuery(this.client, viewerId, filter, cursor, safeLimit);
    if (error) throw new Error(`getFeed: ${error.message}`);

    const rows = (data ?? []) as unknown as PostWithOwnerJoinedRow[];
    const hasMore = rows.length > safeLimit;
    const page = hasMore ? rows.slice(0, safeLimit) : rows;
    const posts = page.map(mapPostWithOwnerRow);
    const projected = await applyPostActorIdentityProjectionBatch(this.client, posts, viewerId);
    const last = projected[projected.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, postId: last.postId }) : null;
    return { posts: projected, nextCursor };
  }

  // ── Single post ─────────────────────────────────────────────────────────
  async findById(
    postId: string,
    viewerId: string | null,
    opts?: { identityListingHostUserId?: string | null },
  ): Promise<PostWithOwner | null> {
    const { data, error } = await this.client
      .from('posts')
      .select(POST_SELECT_OWNER)
      .eq('post_id', postId)
      .maybeSingle();
    if (error) throw new Error(`findById: ${error.message}`);
    if (!data) return null;
    const mapped = mapPostWithOwnerRow(data as unknown as PostWithOwnerJoinedRow);
    const [out] = await applyPostActorIdentityProjectionBatch(this.client, [mapped], viewerId, {
      identityListingHostUserId: opts?.identityListingHostUserId ?? null,
    });
    return out ?? null;
  }

  // ── Mutations ───────────────────────────────────────────────────────────
  async create(input: CreatePostInput): Promise<Post> {
    const { data: insertedPost, error: insertErr } = await this.client
      .from('posts')
      .insert({
        owner_id: input.ownerId,
        type: input.type,
        visibility: input.visibility,
        title: input.title,
        description: input.description,
        category: input.category,
        city: input.address.city,
        street: input.address.street,
        street_number: input.address.streetNumber,
        location_display_level: input.locationDisplayLevel,
        item_condition: input.itemCondition,
        urgency: input.urgency,
        estimated_value: input.estimatedValue ?? null,
      })
      .select('post_id')
      .single();
    if (insertErr) throw mapInsertError(insertErr);
    if (!insertedPost) throw new Error('create.post: no row returned');

    const postId = insertedPost.post_id;

    if (input.mediaAssets.length > 0) {
      const mediaRows = input.mediaAssets.map((m, i) => ({
        post_id: postId,
        ordinal: i,
        path: m.path,
        mime_type: m.mimeType,
        size_bytes: m.sizeBytes,
      }));
      const { error: mediaErr } = await this.client.from('media_assets').insert(mediaRows);
      if (mediaErr) {
        // Best-effort orphan cleanup. If this also fails the post row remains;
        // recovery is by the user editing or deleting it.
        await this.client.from('posts').delete().eq('post_id', postId);
        throw new Error(`create.media: ${mediaErr.message}`);
      }
    }

    const created = await fetchPostById(this.client, postId);
    if (!created) throw new Error(`create: post ${postId} disappeared after insert`);

    if (input.hideFromCounterparty) {
      try {
        await upsertPostActorIdentityRow(this.client, {
          postId,
          userId: input.ownerId,
          surfaceVisibility: input.visibility,
          hideFromCounterparty: true,
        });
      } catch (e) {
        await this.client.from('posts').delete().eq('post_id', postId);
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    return created;
  }

  async update(postId: string, patch: UpdatePostInput): Promise<Post> {
    return executePostUpdate(this.client, postId, patch, (pid) => fetchPostById(this.client, pid));
  }

  async delete(postId: string): Promise<void> {
    const { data, error } = await this.client
      .from('posts')
      .delete()
      .eq('post_id', postId)
      .select('post_id');
    if (error) throw new Error(`delete: ${error.message}`);
    // RLS `posts_delete_self_unlinked` (0053): owner, and the post is open or closed
    // without a recipient row. No row matched → PostgREST returns 200 with an empty
    // array — treat as failure.
    if (!data?.length) {
      throw new PostError(
        'post_owner_delete_forbidden',
        'delete: no row deleted (forbidden status, recipient linked, or not owner)',
      );
    }
  }

  async adminRemove(postId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_remove_post', { p_post_id: postId });
    if (error) {
      // Postgres errcode 42501 (insufficient_privilege) → forbidden.
      // PostgREST surfaces this as `code: '42501'` on the returned error.
      if (error.code === '42501' || /forbidden/i.test(error.message)) {
        throw new PostError('forbidden', error.message);
      }
      throw new Error(`adminRemove: ${error.message}`);
    }
  }

  // ── Closure (FR-CLOSURE-001..005) — delegated to closureMethods ─────────
  close(postId: string, recipientUserId: string | null): Promise<Post> {
    return closePostHelper(this.client, postId, recipientUserId);
  }
  reopen(postId: string): Promise<Post> {
    return reopenPostHelper(this.client, postId);
  }
  republish(postId: string): Promise<string> {
    return republishPostHelper(this.client, postId);
  }
  async unmrkRecipientSelf(postId: string): Promise<void> {
    const { error } = await this.client.rpc('rpc_recipient_unmark_self', { p_post_id: postId });
    if (error) throw new Error(`unmrkRecipientSelf: ${error.message}`);
  }
  getClosureCandidates(postId: string): Promise<ClosureCandidate[]> {
    return getClosureCandidatesHelper(this.client, postId);
  }

  // ── User's own posts ────────────────────────────────────────────────────
  getMyPosts(
    userId: string,
    status: PostStatus[],
    limit: number,
    cursor?: string,
    visibility?: PostVisibility,
    excludeVisibility?: PostVisibility,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> {
    return getMyPostsPage(
      this.client,
      userId,
      status,
      limit,
      cursor,
      visibility,
      excludeVisibility,
    );
  }

  // ── Profile closed posts (publisher ∪ respondent) ────────────────────────
  getProfileClosedPosts(
    profileUserId: string,
    viewerUserId: string | null,
    limit: number,
    cursor?: string,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<ProfileClosedPostsItem[]> {
    return getProfileClosedPostsHelper(
      this.client,
      profileUserId,
      viewerUserId,
      limit,
      cursor,
      listMode ?? 'standard',
    );
  }

  async listPostActorIdentities(postId: string): Promise<PostActorIdentityRow[]> {
    return listPostActorIdentitiesForPost(this.client, postId);
  }

  async upsertPostActorIdentity(input: UpsertPostActorIdentityInput): Promise<void> {
    return upsertPostActorIdentityRow(this.client, input);
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  countOpenByUser(userId: string): Promise<number> {
    return countOpenByUserQuery(this.client, userId);
  }

  countProfilePostsForViewer(ownerId: string, viewerId: string | null): Promise<number> {
    return countProfilePostsForViewerQuery(this.client, ownerId, viewerId);
  }

  countProfileOpenPosts(ownerId: string, options?: { excludeOnlyMe?: boolean }): Promise<number> {
    return countProfileOpenPostsQuery(this.client, ownerId, options);
  }

  countProfileClosedPosts(
    profileUserId: string,
    viewerUserId: string | null,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<number> {
    return countProfileClosedPostsQuery(this.client, profileUserId, viewerUserId, listMode);
  }
}
