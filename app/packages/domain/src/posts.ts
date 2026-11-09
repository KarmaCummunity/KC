// Post + supporting types (MediaAsset, Recipient, ProfileClosedPostsItem).
// Extracted from entities.ts to keep that file under the size cap (TD-29).

import { DomainError } from './errors';
import { canTransition } from './fsm/machine';
import { postMachine } from './fsm/machines/post';
import type {
  Address,
  Category,
  ItemCondition,
  LocationDisplayLevel,
  PostStatus,
  PostType,
  PostVisibility,
} from './value-objects';

export type { PostStatus };

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

/**
 * A status a post can be removed from by an admin and later restored to. A post hidden for
 * review is saved as `open` (it is only ever hidden from `open`), so neither moderation
 * status appears here. Mirrors `posts_status_before_admin_removal_check` (0682).
 */
export type PostStatusBeforeAdminRemoval = Exclude<PostStatus, 'removed_admin' | 'hidden_pending_review'>;

export interface Post {
  readonly postId: string;
  readonly ownerId: string;
  readonly type: PostType;
  status: PostStatus;
  /** The status an admin restore returns to (D129); null unless removed. */
  readonly statusBeforeAdminRemoval: PostStatusBeforeAdminRemoval | null;
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
  /** Set when this post is a challenge (docs/spec/10). Opens the challenge, not the generic post. */
  readonly challengeId?: string | null;
  /** Approximate map position (~100 m): the post's own point, else its city's centre; null = unknown. */
  readonly mapPoint?: { readonly lat: number; readonly lng: number } | null;
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

// ── S1 State Machine (Spec 07 §7.1, D104) ───────────────────────────
// The graph lives once, in the FSM kernel (`fsm/machines/post.ts`), mirrored in the
// Postgres catalog and enforced by the `posts_status_fsm` trigger. These helpers keep
// the post-specific API for callers.

/** Every S1 status, in the kernel's declaration order. */
export const POST_STATUSES: readonly PostStatus[] = postMachine.states;

/**
 * True when `from → to` is a real S1 transition (spec 07 §7.1, D104).
 * A same-status write is not a transition and returns false; the database treats it as
 * a no-op.
 */
export function canTransitionPostStatus(from: PostStatus, to: PostStatus): boolean {
  const answer = canTransition(postMachine, from, to);
  return answer.ok && answer.changed;
}

export class PostStatusTransitionError extends DomainError {
  readonly code = 'posts_status_transition_invalid';
  readonly from: PostStatus;
  readonly to: PostStatus;

  constructor(from: PostStatus, to: PostStatus) {
    super(`Cannot transition post status from ${from} to ${to}`, { from, to });
    this.name = 'PostStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function validatePostStatusTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransitionPostStatus(from, to)) {
    throw new PostStatusTransitionError(from, to);
  }
}

