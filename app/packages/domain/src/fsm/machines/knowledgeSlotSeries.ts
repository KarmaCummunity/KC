import { defineMachine } from '../machine';

/** States of a recurring lesson offer's weekly series (`knowledge_slot_series.status`). */
export const KNOWLEDGE_SLOT_SERIES_STATUSES = ['active', 'paused', 'ended'] as const;
export type KnowledgeSlotSeriesStatus = (typeof KNOWLEDGE_SLOT_SERIES_STATUSES)[number];

/**
 * Weekly series of a recurring lesson offer (`knowledge_slot_series.status`; spec
 * `docs/spec/requirements/23_knowledge.md` FR-KNOW-004 AC1, #2035).
 *
 * - The giver pauses and resumes the series (`set_knowledge_slot_series_status`): a pause removes
 *   the upcoming slots nobody booked, a resume adds the next 30 days again.
 * - Ending, from either state, is final; booked slots stay. The scheduler also ends a series
 *   whose last day has passed.
 *
 * SQL copy: `supabase/migrations/next-01_knowledge_slot_series.sql` (`kc_private.fsm_state` /
 * `fsm_edge` seeds).
 */
export const knowledgeSlotSeriesMachine = defineMachine({
  id: 'knowledge_slot_series',
  states: KNOWLEDGE_SLOT_SERIES_STATUSES,
  edges: [
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'ended' },
    { from: 'paused', to: 'ended' },
  ],
});
