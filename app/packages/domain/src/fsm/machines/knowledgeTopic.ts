import { defineMachine } from '../machine';

/**
 * Knowledge topic (`knowledge_topics.status`; spec `docs/spec/requirements/23_knowledge.md`
 * FR-KNOW-001, migration `0570`).
 *
 * - A member proposes a topic; an operator approves it (`proposed → active`) or merges it into an
 *   active topic, as can be done with an active topic too (`→ merged`, with `merged_into_id`).
 * - `merged` is final. Rejecting a proposal deletes the row, so it is not a state.
 * - Approving an active topic is a same-status no-op: it keeps the original `approved_by`.
 *
 * SQL copy: `supabase/migrations/0701_fsm_comments_knowledge_topics.sql`.
 */
export const knowledgeTopicMachine = defineMachine({
  id: 'knowledge_topic',
  states: ['proposed', 'active', 'merged'] as const,
  edges: [
    { from: 'proposed', to: 'active' },
    { from: 'proposed', to: 'merged' },
    { from: 'active', to: 'merged' },
  ],
});
