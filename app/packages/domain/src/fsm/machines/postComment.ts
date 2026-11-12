import { defineMachine } from '../machine';

/**
 * Post comment (`post_comments.status`; spec `docs/spec/requirements/04_posts.md` post detail
 * engagement, FR-POST-014..018; migrations `0250` / `0251`).
 *
 * - The author or the post owner deletes a comment; that deletion is soft and final.
 * - Staff delete a comment (`admin_delete_comment`) and may bring back what staff removed
 *   (`admin_restore_comment`, FR-ADMIN-013 AC2); the server allows the restore only for a
 *   comment staff removed.
 * - Edits keep the status (`rpc_update_post_comment`), so they are not transitions.
 *
 * SQL copy: `supabase/schemas/30_social/040_post_comments.sql` (`kc_private.fsm_state` / `fsm_edge` seeds)
 * and `supabase/migrations/0016_report_case_tools.sql` (the staff restore edge).
 */
export const postCommentMachine = defineMachine({
  id: 'post_comment',
  states: ['active', 'deleted'] as const,
  edges: [
    { from: 'active', to: 'deleted', roles: ['author', 'post_owner', 'admin'] },
    { from: 'deleted', to: 'active', roles: ['admin'] },
  ],
});
