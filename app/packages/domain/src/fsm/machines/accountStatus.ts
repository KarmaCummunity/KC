import { defineMachine } from '../machine';

/**
 * Account status (`users.account_status`; spec `docs/spec/07_cross_cutting_systems.md` §7.15,
 * D33 / D61, `docs/spec/requirements/08_moderation.md` FR-MOD-010, `12_super_admin.md`).
 *
 * - Verification: a new account waits in `pending_verification` until its phone or email is
 *   confirmed (`handle_user_verified`).
 * - Moderation: 5 distinct reporters suspend (`suspended_admin`), repeated false reports
 *   suspend the reporter (`suspended_for_false_reports`, levels 1–3), an admin bans. A
 *   moderator restores a suspension; only a super admin lifts a ban (checked by
 *   `kc_private` guards in the admin RPCs; the graph itself carries no roles).
 * - A false-report sanction never touches a heavier state: no edge leads from `suspended_admin`
 *   or `banned` to `suspended_for_false_reports`.
 * - Deletion: a member requests it (`pending_deletion`, 30 days) and may restore it to the
 *   status saved before the request. The purge deletes the row; there is no `deleted` state.
 * - A member under deletion is neither suspended nor banned: the account is leaving.
 *
 * SQL copy: `supabase/schemas/10_identity/030_user_account.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const accountStatusMachine = defineMachine({
  id: 'account_status',
  states: ['pending_verification', 'active', 'suspended_for_false_reports', 'suspended_admin', 'banned', 'pending_deletion'] as const,
  edges: [
    { from: 'pending_verification', to: 'active' },
    { from: 'pending_verification', to: 'suspended_for_false_reports' },
    { from: 'pending_verification', to: 'suspended_admin' },
    { from: 'pending_verification', to: 'banned' },
    { from: 'pending_verification', to: 'pending_deletion' },
    { from: 'active', to: 'suspended_for_false_reports' },
    { from: 'active', to: 'suspended_admin' },
    { from: 'active', to: 'banned' },
    { from: 'active', to: 'pending_deletion' },
    { from: 'suspended_for_false_reports', to: 'active' },
    { from: 'suspended_for_false_reports', to: 'suspended_admin' },
    { from: 'suspended_for_false_reports', to: 'banned' },
    { from: 'suspended_admin', to: 'active' },
    { from: 'suspended_admin', to: 'banned' },
    { from: 'banned', to: 'active' },
    { from: 'pending_deletion', to: 'active' },
    { from: 'pending_deletion', to: 'pending_verification' },
  ],
});
