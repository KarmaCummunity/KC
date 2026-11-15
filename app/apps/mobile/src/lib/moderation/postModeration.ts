// D33 / D61 — post moderation statuses as the owner and admins see them.
import { postAdminActions, type PostStatus, type PostStatusBeforeAdminRemoval } from '@kc/domain';

/** Statuses an owner finds in the profile "removed" tab. */
export const OWNER_MODERATED_POST_STATUSES: readonly PostStatus[] = ['removed_admin', 'hidden_pending_review'];

/** Copy for the owner's support-thread bubble after auto-moderation (0452 adds `outcome`). */
export function ownerModerationBubbleKey(payload: Record<string, unknown> | null): string {
  return payload?.outcome === 'hidden_pending_review'
    ? 'moderation.bubble.ownerHiddenForReview.body'
    : 'moderation.bubble.ownerAutoRemoved.body';
}

/** Which admin actions a post row offers, given the admin's permissions. */
export function adminPostActions(
  status: string,
  perms: { canRemove: boolean; canRestore: boolean },
): { remove: boolean; restore: boolean } {
  // What staff may do with the post comes from the post machine (remove whatever is not
  // removed yet; give back a removed or a hidden post); the permissions narrow it.
  const actions = postAdminActions(status);
  return {
    remove: perms.canRemove && actions.remove,
    restore: perms.canRestore && actions.restore,
  };
}

/**
 * The lane of the owner's "removed" tab a post belongs to, by the status it had before the
 * admin removal (D-35): a post that was still live (open or paused) or a legacy row with no
 * saved status goes to `open`; a post that had ended (delivered, closed, expired) to `closed`.
 */
export function removedPostLane(statusBefore: PostStatusBeforeAdminRemoval | null): 'open' | 'closed' {
  return statusBefore === null || statusBefore === 'open' || statusBefore === 'paused' ? 'open' : 'closed';
}
