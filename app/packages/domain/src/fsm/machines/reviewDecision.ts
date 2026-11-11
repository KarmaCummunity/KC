import { defineMachine } from '../machine';

/**
 * Review decision: one shape shared by the operator review queues (spec
 * `docs/spec/requirements/12_super_admin.md` organization applications, `20_organizations.md`;
 * the WhatsApp bot's admin review, `0302` / `0304`; listing claims, `0246`).
 *
 * - An item waits as `pending` until an operator approves or rejects it, once:
 *   `org_applications.status` (`admin_review_org_application`),
 *   `bot_admin_review_items.status` (`api_bot_admin_review_resolve`) and
 *   `claim_requests.status` (no reviewer RPC yet).
 * - Both decisions are final; a new request is a new row.
 *
 * SQL copy: `supabase/migrations/0717_fsm_review_queues.sql`.
 */
export const reviewDecisionMachine = defineMachine({
  id: 'review_decision',
  states: ['pending', 'approved', 'rejected'] as const,
  edges: [
    { from: 'pending', to: 'approved' },
    { from: 'pending', to: 'rejected' },
  ],
});
