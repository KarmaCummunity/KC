// Post + supporting types (MediaAsset, Recipient, ProfileClosedPostsItem).
// Extracted from entities.ts to keep that file under the size cap (TD-29).

import type {
  Address,
  Category,
  ItemCondition,
  LocationDisplayLevel,
  PostStatus,
  PostType,
  PostVisibility,
} from './value-objects';

export interface MediaAsset {
  readonly mediaAssetId: string;
  readonly postId: string | null;
  /** Storage bucket of `path`: uploads live in post-images; a feed mirror borrows its listing's photos from listing-images (D-206). */
  readonly bucket: 'post-images' | 'listing-images';
  readonly path: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface Recipient {
  readonly postId: string;
  readonly recipientUserId: string;
  readonly markedAt: string;
}

export interface Post {
  readonly postId: string;
  readonly ownerId: string;
  readonly type: PostType;
  status: PostStatus;
  readonly statusBeforeAdminRemoval: 'open' | 'closed_delivered' | 'deleted_no_recipient' | null;
  visibility: PostVisibility;
  title: string;
  description: string | null;
  category: Category;
  address: Address;
  locationDisplayLevel: LocationDisplayLevel;
  itemCondition: ItemCondition | null;  // only for Give
  urgency: string | null;               // only for Request
  /** Optional estimated item value 0..1000 (FR-KARMA-004). Give posts only; null otherwise. */
  estimatedValue: number | null;
  mediaAssets: MediaAsset[];
  recipient: Recipient | null;
  reopenCount: number;
  deleteAfter: string | null;
  /** Set on a feed mirror of a native listing (D-206); the detail screen opens that listing instead. */
  readonly listingId: string | null;
  /** Giving world of that listing (`rides`, `housing`…), set exactly when `listingId` is (FR-FEED-020). */
  readonly listingWorldSlug: string | null;
  readonly createdAt: string;
  updatedAt: string;
  /** FR-TRANSLATE — detected BCP-47 source language of title/description; null = not yet detected. */
  sourceLanguage: string | null;
}

// ── Profile closed-posts view ─────────────────

/**
 * Which identity role the profile user occupies on a given closed_delivered post.
 * - 'publisher' — `Post.ownerId === profileUserId`
 * - 'respondent' — `Post.recipient?.recipientUserId === profileUserId`
 *
 * The economic role (giver / receiver) is derived in the UI from
 * (post.type, identityRole).
 */
export type IdentityRoleForViewedProfile = 'publisher' | 'respondent';

/** FR-PROFILE-001 AC4 — main Closed tab vs Hidden (owner OnlyMe) screen. */
export type ProfileClosedPostsListMode = 'standard' | 'owner_only_me';

export interface ProfileClosedPostsItem {
  readonly post: Post;
  readonly identityRole: IdentityRoleForViewedProfile;
  // ISO timestamp of when the post entered its closed state for this identity.
  // Publisher rows: max(recipients.marked_at, posts.updated_at).
  // Respondent rows: recipients.marked_at.
  // Used as the cursor for `getProfileClosedPosts` pagination (exclusive `<`).
  readonly closedAt: string;
}
