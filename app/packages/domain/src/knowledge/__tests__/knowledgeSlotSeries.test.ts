import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_SERIES_DETAIL_KEYS,
  knowledgeSeriesInputFromDetails,
  knowledgeSlotSeriesActions,
  withoutKnowledgeSeriesKeys,
} from '../knowledgeSlotSeries';

// FR-KNOW-003 AC2 / FR-KNOW-004 AC1 (#2479): the weekly schedule of a recurring lesson offer.
const WEEKLY = {
  schedule: 'weekly',
  series_weekdays: [0, 2],
  series_time: '18:00',
  series_duration_minutes: 90,
  series_ends_on: '2026-12-31',
  capacity_per_slot: 3,
  topic: 'algebra',
};

describe('knowledgeSeriesInputFromDetails', () => {
  it('reads a weekly schedule from the create form details', () => {
    expect(knowledgeSeriesInputFromDetails('post-1', WEEKLY)).toEqual({
      postId: 'post-1',
      weekdays: [0, 2],
      startTime: '18:00',
      durationMinutes: 90,
      capacity: 3,
      endsOn: '2026-12-31',
    });
  });

  it('defaults to one place and no last day', () => {
    const { capacity_per_slot: _c, series_ends_on: _e, ...rest } = WEEKLY;
    expect(knowledgeSeriesInputFromDetails('post-1', rest)).toMatchObject({ capacity: 1, endsOn: null });
  });

  it('is null for one-off times', () => {
    expect(knowledgeSeriesInputFromDetails('post-1', { ...WEEKLY, schedule: 'one_off' })).toBeNull();
    expect(knowledgeSeriesInputFromDetails('post-1', { topic: 'algebra' })).toBeNull();
  });
});

describe('withoutKnowledgeSeriesKeys', () => {
  it('keeps the offer details and drops the schedule inputs', () => {
    const kept = withoutKnowledgeSeriesKeys(WEEKLY);
    expect(kept).toEqual({ capacity_per_slot: 3, topic: 'algebra' });
    for (const key of KNOWLEDGE_SERIES_DETAIL_KEYS) expect(kept).not.toHaveProperty(key);
  });
});

describe('knowledgeSlotSeriesActions', () => {
  it('offers what the series machine allows', () => {
    expect(knowledgeSlotSeriesActions('active')).toEqual({ pause: true, resume: false, end: true });
    expect(knowledgeSlotSeriesActions('paused')).toEqual({ pause: false, resume: true, end: true });
    expect(knowledgeSlotSeriesActions('ended')).toEqual({ pause: false, resume: false, end: false });
    expect(knowledgeSlotSeriesActions('archived')).toEqual({ pause: false, resume: false, end: false });
  });
});
