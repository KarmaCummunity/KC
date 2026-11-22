import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { KNOWLEDGE_SLOT_SERIES_STATUSES, knowledgeSlotSeriesMachine } from '../machines/knowledgeSlotSeries';

// FR-KNOW-004 AC1 (#2035): the weekly series of a recurring lesson offer.
describe('knowledge slot series machine', () => {
  it('has the three states of the SQL catalog', () => {
    expect(KNOWLEDGE_SLOT_SERIES_STATUSES).toEqual(['active', 'paused', 'ended']);
  });

  it('pauses and resumes', () => {
    expect(canTransition(knowledgeSlotSeriesMachine, 'active', 'paused').ok).toBe(true);
    expect(canTransition(knowledgeSlotSeriesMachine, 'paused', 'active').ok).toBe(true);
  });

  it('ends from either state, for good', () => {
    expect(canTransition(knowledgeSlotSeriesMachine, 'active', 'ended').ok).toBe(true);
    expect(canTransition(knowledgeSlotSeriesMachine, 'paused', 'ended').ok).toBe(true);
    expect(isTerminal(knowledgeSlotSeriesMachine, 'ended')).toBe(true);
    expect(canTransition(knowledgeSlotSeriesMachine, 'ended', 'active')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});
