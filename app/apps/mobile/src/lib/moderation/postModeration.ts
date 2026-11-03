// D33 / D61 — post moderation statuses as the owner and admins see them.
import type { PostStatus } from '@kc/domain';

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
    remove: perms.canRemove && (status === 'open' || hidden),
    restore: perms.canRestore && (status === 'removed_admin' || hidden),
  };
}
