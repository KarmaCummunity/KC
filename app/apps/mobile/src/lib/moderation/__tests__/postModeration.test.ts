// D33 / D61 — a post hidden for review is shown to its owner with its own copy,
// and admins can restore or remove it like an admin-removed post.
import { describe, expect, it } from 'vitest';
import { OWNER_MODERATED_POST_STATUSES, adminPostActions, ownerModerationBubbleKey } from '../postModeration';

describe('post moderation helpers', () => {
  it('tells the owner a post is hidden for review, and keeps the removal copy otherwise', () => {
    expect(ownerModerationBubbleKey({ kind: 'owner_auto_removed', outcome: 'hidden_pending_review' })).toBe(
      'moderation.bubble.ownerHiddenForReview.body',
    );
    expect(ownerModerationBubbleKey({ kind: 'owner_auto_removed', target_type: 'user' })).toBe(
      'moderation.bubble.ownerAutoRemoved.body',
    );
    expect(ownerModerationBubbleKey(null)).toBe('moderation.bubble.ownerAutoRemoved.body');
  });

  it('lists hidden posts with admin-removed ones on the owner profile', () => {
    expect(OWNER_MODERATED_POST_STATUSES).toEqual(['removed_admin', 'hidden_pending_review']);
  });

  it('lets admins restore and remove a hidden post', () => {
    const all = { canRemove: true, canRestore: true };
    expect(adminPostActions('hidden_pending_review', all)).toEqual({ remove: true, restore: true });
    expect(adminPostActions('open', all)).toEqual({ remove: true, restore: false });
    expect(adminPostActions('removed_admin', all)).toEqual({ remove: false, restore: true });
    expect(adminPostActions('hidden_pending_review', { canRemove: false, canRestore: false })).toEqual({ remove: false, restore: false });
  });
});
