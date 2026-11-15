import { defineMachine } from '../machine';

/**
 * Report lifecycle (`reports.status`; spec `docs/spec/07_cross_cutting_systems.md` §7.15,
 * `docs/spec/requirements/08_moderation.md` FR-MOD-005 / FR-MOD-010).
 *
 * - A report is opened by its reporter and resolved once by an admin: a confirmed violation
 *   or a dismissal (`admin_confirm_report`, `admin_dismiss_report`, `admin_restore_target`).
 * - Both outcomes are final. A dismissal is what counts against the reporter (FR-MOD-010),
 *   so it is never reopened or turned into a confirmation.
 *
 * SQL copy: `supabase/schemas/60_moderation/040_reports.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const reportMachine = defineMachine({
  id: 'report',
  states: ['open', 'confirmed_violation', 'dismissed_no_violation'] as const,
  edges: [
    { from: 'open', to: 'confirmed_violation', roles: ['admin'] },
    { from: 'open', to: 'dismissed_no_violation', roles: ['admin'] },
  ],
});
