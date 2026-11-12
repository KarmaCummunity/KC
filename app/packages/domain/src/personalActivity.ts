// Personal activity timeline entries (FR-STATS-003).
// `kind` values align with the `rpc_my_activity_timeline` contract in migration 0030.

export type PersonalActivityKind =
  | 'post_created'
  | 'post_closed_delivered'
  | 'post_closed_no_recipient'
  | 'post_reopened'
  | 'marked_as_recipient'
  | 'unmarked_as_recipient'
  | 'post_expired'
  | 'post_removed_admin';

export interface PersonalActivityItem {
  readonly occurredAt: string;
  readonly kind: PersonalActivityKind;
  readonly postId: string;
  readonly postTitle: string;
  /** Present when `kind === 'marked_as_recipient'` (post owner display name). */
  readonly actorDisplayName: string | null;
  /** World of the post's listing (`0742`); null for a social post or a post that no longer exists. */
  readonly worldSlug: string | null;
}
