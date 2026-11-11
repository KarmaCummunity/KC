import type {
  Post,
  ProfileClosedPostsItem,
  ProfileClosedPostsListMode,
  Address,
  Category,
  FeedSortOrder,
  FeedStatusFilter,
  ItemCondition,
  LocationDisplayLevel,
  LocationFilter,
  PostStatus,
  PostType,
  PostVisibility,
  VerificationLevel,
} from '@kc/domain';

import type { PostActorIdentityRow, UpsertPostActorIdentityInput } from './postActorIdentity';

/**
 * Filter shape consumed by IPostRepository.getFeed.
 * Mapped to FR-FEED-004 (filter modal), FR-FEED-005 (persisted state),
 * FR-FEED-006 (distance sort).
 *
 * `city` (single-string equality), `includeClosed`, and `sortBy: 'newest'|'city'`
 * from the prior shape were dropped:
 *   - `city` equality replaced by `locationFilter` (city + radius).
 *   - `includeClosed` boolean expanded to `statusFilter` 3-mode.
 *   - `sortBy: 'city'` replaced by `sortOrder: 'distance'` with Haversine.
 */
export interface PostFeedFilter {
  type?: PostType;
  categories?: Category[];          // empty/undefined = no category filter
  worlds?: string[];                // empty/undefined = no worlds filter
  subcategories?: string[];         // empty/undefined = no subcategories filter
  itemConditions?: ItemCondition[]; // empty/undefined = no condition filter; ignored unless type === 'Give'
  locationFilter?: LocationFilter;  // city + radius (km); undefined = no spatial filter
  statusFilter?: FeedStatusFilter;  // 'open' (default) | 'closed' | 'all'
  sortOrder?: FeedSortOrder;        // 'newest' (default) | 'oldest' | 'distance'
  proximitySortCity?: string;       // city_id of center for distance sort; undefined = viewer's city
  followersOnly?: boolean;          // true = restrict to posts whose owner the viewer follows (FR-FEED-020)
  /** Trimmed free-text; applied only when length >= 2 after normalize (FR-FEED-003). */
  searchQuery?: string;}

export interface FeedPage {
  posts: PostWithOwner[];
  nextCursor: string | null;
}

export interface PostWithOwner extends Post {
  ownerName: string | null;
  ownerAvatarUrl: string | null;
  ownerHandle: string;
  ownerPrivacyMode: 'Public' | 'Private';
  /** FR-VERIFY-001 owner badge; 0 when the owner's identity is masked. Absent = 0. */
  ownerVerificationLevel?: VerificationLevel;
  /**
   * Populated when a post is `closed_delivered` and the recipients row was joined.
   * The label rendered on PostDetail depends on `post.type`:
   *   - Give    → "delivered to {recipientUser.displayName}"
   *   - Request → "given by {recipientUser.displayName}"
   * Tap opens /user/{shareHandle}.
   */
  recipientUser: {
    userId: string;
    /** Null during the `pending_basic_info` window (migration 0084). UI renders fallback. */
    displayName: string | null;
    shareHandle: string;
    avatarUrl: string | null;
    /** FR-VERIFY-001; 0 when the counterparty identity is masked. */
    verificationLevel?: VerificationLevel;
  } | null;
  /**
   * Great-circle distance from the proximity-sort center to this post's city.
   * Populated only when the feed query ran with `sortOrder === 'distance'`;
   * `null` otherwise (or when either side lacks coordinates).
   */
  distanceKm: number | null;
  /** When false, post-detail must not deep-link to the owner's profile from this post surface. */
  ownerProfileNavigableFromPost?: boolean;
  /** When false, post-detail must not deep-link to the recipient's profile from this post surface. */
  recipientProfileNavigableFromPost?: boolean;
}

/** One page of the profile closed-posts tab; `nextCursor` is null on the last page. */
export interface ProfileClosedPostsPage {
  items: ProfileClosedPostsItem[];
  nextCursor: string | null;
}

/** FR-CLOSURE-003 AC1/AC2 — chat-partner candidate for the recipient picker. */
export interface ClosureCandidate {
  userId: string;
  /** Null during the `pending_basic_info` window (migration 0084). UI renders fallback. */
  fullName: string | null;
  avatarUrl: string | null;
  cityName: string | null;
  /** ISO timestamp of the latest message in the anchored chat. Used for sort. */
  lastMessageAt: string;
}

export interface MediaAssetInput {
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreatePostInput {
  ownerId: string;
  type: PostType;
  visibility: PostVisibility;
  title: string;
  description: string | null;
  category: Category;
  address: Address;
  locationDisplayLevel: LocationDisplayLevel;
  itemCondition: ItemCondition | null;
  urgency: string | null;
  /** FR-KARMA-004 — estimated item value 0..1000 (Give only). Optional; null/absent = unset. */
  estimatedValue?: number | null;
  mediaAssets: MediaAssetInput[];
  /**
   * FR-POST-021 + D-31 — when true, persists `hide_from_counterparty` at publish time so
   * third-party viewers on the counterparty's closed-post profile surface see anonymous chrome for the owner.
   */
  hideFromCounterparty?: boolean;
}

export interface UpdatePostInput {
  title?: string;
  description?: string | null;
  category?: Category;
  address?: Address;
  locationDisplayLevel?: LocationDisplayLevel;
  itemCondition?: ItemCondition | null;
  urgency?: string | null;
  visibility?: PostVisibility;
  /** When set, replaces all `media_assets` rows for the post (FR-POST-008 AC1). */
  mediaAssets?: MediaAssetInput[];
}

export interface IPostRepository {
  // Feed
  getFeed(
    viewerId: string | null,
    filter: PostFeedFilter,
    limit: number,
    cursor?: string,
  ): Promise<FeedPage>;

  // Single post
  findById(
    postId: string,
    viewerId: string | null,
    opts?: { identityListingHostUserId?: string | null },
  ): Promise<PostWithOwner | null>;

  // Mutations
  create(input: CreatePostInput): Promise<Post>;
  update(postId: string, patch: UpdatePostInput): Promise<Post>;
  delete(postId: string): Promise<void>;

  /**
   * FR-ADMIN-009 — flip a post's status to `removed_admin` via the
   * `admin_remove_post` RPC. Server re-checks `is_admin(auth.uid())`;
   * non-admin callers receive a `forbidden` PostError.
   *
   * Idempotent: calling again on an already-removed post is a quiet
   * no-op (no second audit row).
   */
  adminRemove(postId: string): Promise<void>;

  // Closure (FR-CLOSURE-001..005)
  // close: branches inside the impl —
  //   recipientUserId !== null  → RPC `close_post_with_recipient` (atomic insert + status)
  //   recipientUserId === null  → UPDATE status='deleted_no_recipient', delete_after=now()+7d
  // Both paths bump items_given_count via the existing posts trigger; the
  // recipient path also bumps items_received_count via the recipients trigger.
  close(postId: string, recipientUserId: string | null): Promise<Post>;
  /** FR-CLOSURE-011 — name who received an open offer, or close items/animals with nobody named. */
  ownerCompleteOffer(
    targetId: string,
    recipientUserId: string | null,
    mode: 'assign' | 'close_without',
  ): Promise<{ closed: boolean }>;
  // reopen: branches inside the impl —
  //   current status closed_delivered      → RPC `reopen_post_marked` (delete recipient row + status)
  //   current status deleted_no_recipient  → UPDATE status='open', delete_after=null
  reopen(postId: string): Promise<Post>;
  /**
   * FR-POST-013 AC3 — clones an expired post (and its media_assets rows) into
   * a new `status='open'` post. Returns the new post id. Errors:
   *   republish_not_owner, republish_wrong_status, republish_not_found,
   *   active_post_limit_exceeded, followers_only_requires_private.
   */
  republish(postId: string): Promise<string>;
  // FR-CLOSURE-007: recipient removes their own credit (→ deleted_no_recipient, 7d window).
  unmrkRecipientSelf(postId: string): Promise<void>;
  /** Recipient picker source: distinct chat partners on this post, sorted by latest message recency. */
  getClosureCandidates(postId: string): Promise<ClosureCandidate[]>;

  // User's own posts (audit §3.10 — paginated; was Post[]).
  getMyPosts(
    userId: string,
    status: PostStatus[],
    limit: number,
    cursor?: string,
    visibility?: PostVisibility,
    excludeVisibility?: PostVisibility,
  ): Promise<{ posts: Post[]; nextCursor: string | null }>;

  /**
   * Closed-posts tab on a profile screen: the posts `profileUserId` published that were
   * delivered (or, for the owner, deleted without a recipient), newest first, paged by an
   * opaque keyset cursor. Row-level security narrows the list to what `viewerUserId` may
   * read. Every item is a `publisher` item: the baseline lists a member's own posts only.
   *
   * Mapped to FR-PROFILE-001 AC4 (revised), FR-PROFILE-002 AC2 (revised),
   * FR-POST-017 AC1 (revised).
   */
  getProfileClosedPosts(
    profileUserId: string,
    viewerUserId: string | null,
    limit: number,
    cursor?: string,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<ProfileClosedPostsPage>;

  /** FR-POST-021 — per-actor identity exposure rows for a post. */
  listPostActorIdentities(postId: string): Promise<PostActorIdentityRow[]>;
  upsertPostActorIdentity(input: UpsertPostActorIdentityInput): Promise<void>;

  // Stats
  countOpenByUser(userId: string): Promise<number>;
  /** FR-PROFILE-013 — profile headline counter (open + closed, viewer-aware). */
  countProfilePostsForViewer(ownerId: string, viewerId: string | null): Promise<number>;
  /** FR-PROFILE-001 AC4 — open-tab badge count. */
  countProfileOpenPosts(ownerId: string, options?: { excludeOnlyMe?: boolean }): Promise<number>;
  /** FR-PROFILE-001 AC4 — closed-tab badge count. */
  countProfileClosedPosts(
    profileUserId: string,
    viewerUserId: string | null,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<number>;
}
