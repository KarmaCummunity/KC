// What a person may do with a post, read from the post machine (`fsm/machines/post.ts`).
// Screens and use cases ask these helpers instead of comparing a status to literals, so a
// button is offered exactly when the server accepts the move (issue #2204, spec 07 §7.1).
import { canTransition } from './fsm/machine';
import { postMachine } from './fsm/machines/post';
import type { PostStatus } from './value-objects';

/** The roles a person can act in; `system` moves (expiry, review) are never offered. */
type PostActor = 'owner' | 'admin';

/** The actions the owner of a post is offered. */
export interface PostOwnerActions {
  /** Edit the fields of the post. */
  readonly edit: boolean;
  /** Take the post off the feeds for a while. */
  readonly pause: boolean;
  /** Bring a paused post back. */
  readonly resume: boolean;
  /** Close the post as delivered. */
  readonly close: boolean;
  /** Bring a closed or deleted post back to open. */
  readonly reopen: boolean;
  /** Delete the post (close it without a recipient). */
  readonly delete: boolean;
  /** Publish the post again as a new one. */
  readonly republish: boolean;
}

/** The actions a staff member is offered on a post. */
export interface PostAdminActions {
  /** Remove the post from the product. */
  readonly remove: boolean;
  /** Give a removed or hidden post back. */
  readonly restore: boolean;
}

/** True only for a real edge `status → to` open to `role`; an unknown status offers nothing. */
function isMove(status: string, to: PostStatus, role: PostActor): boolean {
  const answer = canTransition(postMachine, status, to, role);
  return answer.ok && answer.changed;
}

/**
 * The statuses in which the owner edits the post's fields: before it is published, while it
 * is open and while it is paused (spec 07 §7.1; the same list as the `posts_update_owner`
 * row policy). Editing is not a status move, so it is a list here and not an edge.
 */
const OWNER_EDITABLE: readonly string[] = ['draft', 'open', 'paused'] satisfies readonly PostStatus[];

/** Whether the owner may edit the fields of a post in `status`. */
export function isPostEditableByOwner(status: string): boolean {
  return OWNER_EDITABLE.includes(status);
}

/** The statuses of a post that ended: delivered, deleted by its owner, or expired. */
const ENDED: readonly string[] = ['closed_delivered', 'deleted_no_recipient', 'expired'] satisfies readonly PostStatus[];

/** Whether a post in `status` ended, so a card shows it as closed. Display only. */
export function isPostEnded(status: string): boolean {
  return ENDED.includes(status);
}

/**
 * The owner's actions on a post in `status`.
 * - `resume` and `reopen` are the same move (`→ open`): leaving a pause is a resume, leaving
 *   an ending is a reopen. A draft goes to open by publishing, which is neither.
 * - `republish` is the way back from `expired`, which has no edge to `open` (D127).
 * Rules that read other rows (a live handoff, the reopen window, the post's own expiry) stay
 * with the server and with the screen that knows them.
 */
export function postOwnerActions(status: string): PostOwnerActions {
  const toOpen = isMove(status, 'open', 'owner');
  return {
    edit: isPostEditableByOwner(status),
    pause: isMove(status, 'paused', 'owner'),
    resume: toOpen && status === 'paused',
    close: isMove(status, 'closed_delivered', 'owner'),
    reopen: toOpen && status !== 'paused' && status !== 'draft',
    delete: isMove(status, 'deleted_no_recipient', 'owner'),
    republish: status === 'expired',
  };
}

/**
 * The staff actions on a post in `status`: remove whatever is not removed yet, and give back
 * a post that staff or the review queue took off (any staff edge that leaves the status
 * without removing it).
 */
export function postAdminActions(status: string): PostAdminActions {
  return {
    remove: isMove(status, 'removed_admin', 'admin'),
    restore: postMachine.states.some((to) => to !== 'removed_admin' && isMove(status, to, 'admin')),
  };
}
