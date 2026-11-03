// Behavioural in-memory IPostRepository (G39). Unlike FakePostRepository (a
// spy with canned results for use-case tests), this fake models the owner-side
// lifecycle the Supabase adapter implements — status machine, RLS-like owner
// gates, paging — and is held to it by the shared contract
// (`contracts/postRepository.contract.ts`). Viewer-dependent reads, admin
// flows and feed ranking are not modelled and fail loudly.

import type { Post, PostStatus, PostVisibility, ProfileClosedPostsItem } from '@kc/domain';
import type {
  ClosureCandidate,
  CreatePostInput,
  FeedPage,
  IPostRepository,
  PostFeedFilter,
  PostWithOwner,
  UpdatePostInput,
} from '../../ports/IPostRepository';
import type { PostActorIdentityRow, UpsertPostActorIdentityInput } from '../../ports/postActorIdentity';
import { PostError } from '../errors';
import { clonePost, identityKey, isPostVisibleTo, type InMemoryPostStore } from './inMemoryPostStore';

const DELETE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_MAX = 100;

function notModelled(method: string): never {
  throw new PostError('unknown', `InMemoryPostRepository: ${method} is not modelled by the contract fake`);
}

export class InMemoryPostRepository implements IPostRepository {
  /** `actorId` plays `auth.uid()`: the identity every owner gate is checked against. */
  constructor(
    private readonly store: InMemoryPostStore,
    private readonly actorId: string,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────
  async getFeed(_viewerId: string | null, _filter: PostFeedFilter, _limit: number): Promise<FeedPage> {
    return notModelled('getFeed');
  }

  async findById(postId: string, viewerId: string | null): Promise<PostWithOwner | null> {
    const post = this.store.posts.get(postId);
    if (!post || !this.visibleTo(post, viewerId)) return null;
    return this.store.withOwner(post);
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  async create(input: CreatePostInput): Promise<Post> {
    if (input.ownerId !== this.actorId) throw new PostError('forbidden', 'create: owner must be the actor');
    if (!this.store.cities.has(input.address.city)) throw new PostError('city_not_found', input.address.city);
    const now = this.store.now();
    const postId = crypto.randomUUID();
    const post: Post = {
      postId,
      ownerId: input.ownerId,
      type: input.type,
      status: 'open',
      statusBeforeAdminRemoval: null,
      visibility: input.visibility,
      title: input.title,
      description: input.description,
      category: input.category,
      address: { ...input.address },
      locationDisplayLevel: input.locationDisplayLevel,
      itemCondition: input.itemCondition,
      urgency: input.urgency,
      estimatedValue: input.estimatedValue ?? null,
      mediaAssets: input.mediaAssets.map((m) => ({
        mediaAssetId: crypto.randomUUID(),
        postId,
        bucket: 'post-images' as const,
        path: m.path,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        createdAt: now,
      })),
      recipient: null,
      reopenCount: 0,
      deleteAfter: null,
      listingId: null,
      listingWorldSlug: null,
      createdAt: now,
      updatedAt: now,
      sourceLanguage: null,
    };
    this.store.posts.set(postId, post);
    return clonePost(post);
  }

  async update(postId: string, patch: UpdatePostInput): Promise<Post> {
    const post = this.requireOwn(postId);
    const { mediaAssets, ...fields } = patch;
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (post as unknown as Record<string, unknown>)[key] = value;
    }
    if (mediaAssets !== undefined) {
      post.mediaAssets = mediaAssets.map((m) => ({
        mediaAssetId: crypto.randomUUID(),
        postId,
        bucket: 'post-images' as const,
        path: m.path,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        createdAt: this.store.now(),
      }));
    }
    post.updatedAt = this.store.now();
    return clonePost(post);
  }

  // RLS `posts_delete_self_unlinked` (0053): the owner may delete an open post, or a closed
  // one with no recipient row; anything else matches no row.
  async delete(postId: string): Promise<void> {
    const post = this.store.posts.get(postId);
    const unlinkedClosed = post?.recipient === null
      && (post.status === 'deleted_no_recipient' || post.status === 'closed_delivered');
    if (!post || post.ownerId !== this.actorId || !(post.status === 'open' || unlinkedClosed)) {
      throw new PostError('post_owner_delete_forbidden', 'delete: no row deleted');
    }
    this.store.removePost(postId);
  }

  async adminRemove(_postId: string): Promise<void> {
    return notModelled('adminRemove');
  }

  // ── Closure (FR-CLOSURE-001..005) ────────────────────────────────────────
  async close(postId: string, recipientUserId: string | null): Promise<Post> {
    const post = this.requireOwn(postId);
    if (post.status !== 'open') throw new PostError('closure_wrong_status', 'closure_wrong_status');
    const now = this.store.now();
    if (recipientUserId === null) {
      post.status = 'deleted_no_recipient';
      post.deleteAfter = new Date(Date.parse(now) + DELETE_WINDOW_MS).toISOString();
    } else {
      post.status = 'closed_delivered';
      post.recipient = { postId, recipientUserId, markedAt: now };
    }
    post.updatedAt = now;
    return clonePost(post);
  }

  async reopen(postId: string): Promise<Post> {
    const post = this.requireOwn(postId);
    if (post.status !== 'closed_delivered' && post.status !== 'deleted_no_recipient') {
      throw new PostError('closure_wrong_status', 'closure_wrong_status');
    }
    post.status = 'open';
    post.recipient = null;
    post.deleteAfter = null;
    post.reopenCount += 1;
    post.updatedAt = this.store.now();
    return clonePost(post);
  }

  async republish(_postId: string): Promise<string> {
    return notModelled('republish');
  }

  async unmrkRecipientSelf(_postId: string): Promise<void> {
    return notModelled('unmrkRecipientSelf');
  }

  async getClosureCandidates(_postId: string): Promise<ClosureCandidate[]> {
    return [];
  }

  // ── Owner's posts ────────────────────────────────────────────────────────
  async getMyPosts(
    userId: string,
    status: PostStatus[],
    limit: number,
    cursor?: string,
    visibility?: PostVisibility,
    excludeVisibility?: PostVisibility,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> {
    if (status.length === 0) return { posts: [], nextCursor: null };
    const safeLimit = Math.max(1, Math.min(limit, PAGE_MAX));
    const rows = this.ownedBy(userId)
      .filter((p) => status.includes(p.status))
      .filter((p) => (visibility ? p.visibility === visibility : true))
      .filter((p) => (excludeVisibility ? p.visibility !== excludeVisibility : true))
      .filter((p) => (cursor ? p.createdAt < cursor : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const page = rows.slice(0, safeLimit);
    const last = page[page.length - 1];
    // The adapter's cursor is opaque to callers; here it is the last createdAt.
    const nextCursor = rows.length > safeLimit && last ? last.createdAt : null;
    return { posts: page.map(clonePost), nextCursor };
  }

  async getProfileClosedPosts(): Promise<ProfileClosedPostsItem[]> {
    return notModelled('getProfileClosedPosts');
  }

  // ── Per-actor identity (FR-POST-021) ─────────────────────────────────────
  async listPostActorIdentities(postId: string): Promise<PostActorIdentityRow[]> {
    return [...this.store.actorIdentities.values()].filter((row) => row.postId === postId);
  }

  async upsertPostActorIdentity(input: UpsertPostActorIdentityInput): Promise<void> {
    this.store.actorIdentities.set(identityKey(input.postId, input.userId), { ...input });
  }

  // ── Counters ─────────────────────────────────────────────────────────────
  async countOpenByUser(userId: string): Promise<number> {
    return this.ownedBy(userId).filter((p) => p.status === 'open').length;
  }

  async countProfilePostsForViewer(ownerId: string, viewerId: string | null): Promise<number> {
    return this.ownedBy(ownerId)
      .filter((p) => p.status === 'open' || p.status === 'closed_delivered')
      .filter((p) => this.visibleTo(p, viewerId)).length;
  }

  async countProfileOpenPosts(ownerId: string, options?: { excludeOnlyMe?: boolean }): Promise<number> {
    return this.ownedBy(ownerId)
      .filter((p) => p.status === 'open')
      .filter((p) => !(options?.excludeOnlyMe && p.visibility === 'OnlyMe')).length;
  }

  async countProfileClosedPosts(profileUserId: string, viewerUserId: string | null): Promise<number> {
    return [...this.store.posts.values()]
      .filter((p) => p.status === 'closed_delivered')
      .filter((p) => p.ownerId === profileUserId || p.recipient?.recipientUserId === profileUserId)
      .filter((p) => this.visibleTo(p, viewerUserId)).length;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private ownedBy(userId: string): Post[] {
    return [...this.store.posts.values()].filter((p) => p.ownerId === userId);
  }

  /** Owner-gated row access: RLS hides other users' rows from an UPDATE, so the caller sees "not found". */
  private requireOwn(postId: string): Post {
    const post = this.store.posts.get(postId);
    if (!post || post.ownerId !== this.actorId) throw new PostError('not_found', `post ${postId} not found`);
    return post;
  }

  /** The store's `is_post_visible_to` slice (owner, hidden statuses, OnlyMe). */
  private visibleTo(post: Post, viewerId: string | null): boolean {
    return isPostVisibleTo(post, viewerId);
  }
}
