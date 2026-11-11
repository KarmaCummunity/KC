import { defineMachine } from '../machine';

/**
 * Post comment (`post_comments.status`; spec `docs/spec/requirements/04_posts.md` post detail
 * engagement, FR-POST-014..018; migrations `0250` / `0251`).
 *
 * - The author deletes their own comment (`rpc_delete_post_comment`); deletion is soft and final:
 *   there is no restore and no admin path.
 * - Edits keep the status (`rpc_update_post_comment`), so they are not transitions.
 *
 * SQL copy: `supabase/schemas/30_social/040_post_comments.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const postCommentMachine = defineMachine({
  id: 'post_comment',
  states: ['active', 'deleted'] as const,
  edges: [
    { from: 'active', to: 'deleted', roles: ['author', 'post_owner', 'admin'] },
  ],
});
