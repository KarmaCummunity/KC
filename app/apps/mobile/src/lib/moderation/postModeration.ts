// D33 / D61 — post moderation statuses as the owner and admins see them.
import type { PostStatus, PostStatusBeforeAdminRemoval } from '@kc/domain';

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
  const hidden = status === 'hidden_pending_review';
  return {
    // Any post that is not already removed can be removed (`admin_remove_post`, 0682).
    remove: perms.canRemove && status !== 'removed_admin',
    restore: perms.canRestore && (status === 'removed_admin' || hidden),
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
