// FR-KNOW-003 AC2 / FR-KNOW-004 AC1 (docs/spec/requirements/23_knowledge.md, #2035, #2479) — the
// weekly series of a recurring lesson offer. The server keeps the series' bookable slots 30 days
// ahead (`knowledge_slot_series`); these pure rules read the create form's schedule inputs, keep
// them out of the post's details and derive the giver's controls from the series machine.
import { allowsMove } from '../fsm/machine';
import { knowledgeSlotSeriesMachine, type KnowledgeSlotSeriesStatus } from '../fsm/machines/knowledgeSlotSeries';
import { isRideWeekday, type RideWeekday } from '../rides/RideSeries';

/** How a lesson offer's times are given on the create form (`details.schedule`). */
export const KNOWLEDGE_SCHEDULE_MODES = ['one_off', 'weekly'] as const;
export type KnowledgeScheduleMode = (typeof KNOWLEDGE_SCHEDULE_MODES)[number];

/**
 * Create-form inputs of a weekly schedule. The server keeps them on the series, not in the post's
 * details, so they are removed from the details before the post is written.
 */
export const KNOWLEDGE_SERIES_DETAIL_KEYS = [
  'schedule',
  'series_weekdays',
  'series_time',
  'series_duration_minutes',
  'series_ends_on',
] as const;

/** What `start_knowledge_slot_series` takes. `startTime` is `HH:mm` Israel time; `endsOn` an ISO day. */
export interface KnowledgeSlotSeriesInput {
  readonly postId: string;
  readonly weekdays: readonly RideWeekday[];
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly capacity: number;
  readonly endsOn: string | null;
}

/** A lesson offer's series as every reader of the offer sees it. */
export interface KnowledgeSlotSeries extends KnowledgeSlotSeriesInput {
  readonly status: KnowledgeSlotSeriesStatus;
}

/**
 * The series a lesson offer's create-form details ask for, or null when its times are one-off
 * (no `schedule`, or `one_off`). Values are read as they are; the server judges them
 * (`knowledge_series_schedule_invalid`).
 */
export function knowledgeSeriesInputFromDetails(
  postId: string,
  details: Readonly<Record<string, unknown>>,
): KnowledgeSlotSeriesInput | null {
  if (details.schedule !== 'weekly') return null;
  const weekdays = Array.isArray(details.series_weekdays) ? details.series_weekdays.filter(isRideWeekday) : [];
  const capacity = details.capacity_per_slot;
  const endsOn = details.series_ends_on;
  return {
    postId,
    weekdays,
    startTime: typeof details.series_time === 'string' ? details.series_time : '',
    durationMinutes: Number(details.series_duration_minutes),
    capacity: typeof capacity === 'number' ? capacity : 1,
    endsOn: typeof endsOn === 'string' && endsOn !== '' ? endsOn : null,
  };
}

/** The details without the weekly schedule inputs (what the post itself stores). */
export function withoutKnowledgeSeriesKeys(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const drop = new Set<string>(KNOWLEDGE_SERIES_DETAIL_KEYS);
  return Object.fromEntries(Object.entries(details).filter(([key]) => !drop.has(key)));
}

/** The giver's controls on a series (FR-KNOW-004 AC1). */
export interface KnowledgeSlotSeriesActions {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly end: boolean;
}

/**
 * Derives the controls from `knowledgeSlotSeriesMachine`, so the screen offers what the RPC
 * accepts. An ended series, or a status the app does not know (a newer server), offers nothing.
 */
export function knowledgeSlotSeriesActions(status: string): KnowledgeSlotSeriesActions {
  return {
    pause: allowsMove(knowledgeSlotSeriesMachine, status, 'paused'),
    resume: allowsMove(knowledgeSlotSeriesMachine, status, 'active'),
    end: allowsMove(knowledgeSlotSeriesMachine, status, 'ended'),
  };
}
