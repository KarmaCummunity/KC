import { defineMachine } from '../machine';

/**
 * Knowledge topic (`knowledge_topics.status`; spec `docs/spec/requirements/23_knowledge.md`
 * FR-KNOW-001 AC5).
 *
 * - A suggested topic is approved (`proposed → active`) or folded into another topic, as an
 *   active topic can be too (`→ merged`, with `merged_into_id`).
 * - `merged` is final: the slug of a merged topic keeps resolving to its replacement.
 *   Rejecting a suggestion deletes the row, so it is not a state.
 *
 * SQL copy: `supabase/migrations/0050_knowledge_topic_embedding_job_machines.sql`.
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
