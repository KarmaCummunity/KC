// Personal activity timeline entries (FR-STATS-003).
// `kind` values align with the `rpc_my_activity_timeline` contract in migration 0030.

/**
 * Kind of an entry on the member's personal activity timeline (`rpc_my_activity_timeline`).
 * @invariant Values match the server contract in migration 0030 (FR-STATS-003).
 */
export type PersonalActivityKind =
  | 'post_created'
  | 'post_closed_delivered'
  | 'post_closed_no_recipient'
  | 'post_reopened'
  | 'marked_as_recipient'
  | 'unmarked_as_recipient'
  | 'post_expired'
  | 'post_removed_admin';

/**
 * One row on the signed-in member's activity timeline (post lifecycle and recipient marks).
 */
export interface PersonalActivityItem {
  /** ISO-8601 timestamp when the activity occurred. */
  readonly occurredAt: string;
  readonly kind: PersonalActivityKind;
  /** Post the activity refers to. */
  readonly postId: string;
  /** Display title of that post at read time. */
  readonly postTitle: string;
  /** Present when `kind === 'marked_as_recipient'` (post owner display name). */
  readonly actorDisplayName: string | null;
  /** World of the post's listing (`0742`); null for a social post or a post that no longer exists. */
  readonly worldSlug: string | null;
}
