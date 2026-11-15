import { defineMachine } from '../machine';

/**
 * Review decision of a WhatsApp bot post under review (`integrations.bot_review_items.status`,
 * M22 / L7). A low-confidence bot post waits as `pending`; a moderator approves (publishes it)
 * or rejects it in `api_whatsapp_admin_review_resolve`. Both decisions are final. Who may
 * decide is checked by that RPC, so no edge is role-restricted.
 *
 * SQL copy: the migration `whatsapp_channel_schema` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const reviewDecisionMachine = defineMachine({
  id: 'review_decision',
  states: ['pending', 'approved', 'rejected'] as const,
  edges: [
    { from: 'pending', to: 'approved' },
    { from: 'pending', to: 'rejected' },
  ],
});
