// A recurring time post (FR-POST-024, `docs/spec/requirements/04_posts.md`): the owner publishes a
// series once — weekdays, a local start time and duration, an optional end date — and the server
// publishes each upcoming date as an ordinary post (an "occurrence") that takes its own
// registrations. A date's event details carry its series and day (`series_id`, `series_on`).
import { isRideWeekday, type RideWeekday } from '../rides/RideSeries';

/** Days ahead the server keeps a series' dates published (`kc_private.post_series_materialize`). */
export const POST_SERIES_LOOKAHEAD_DAYS = 30;

/** `ended` is final: the owner publishes a new series instead (FR-POST-024 AC8–AC9). */
export const POST_SERIES_STATUSES = ['active', 'paused', 'ended'] as const;
export type PostSeriesStatus = (typeof POST_SERIES_STATUSES)[number];

/** Bounds of one date's length, as the server checks them (`post_series_duration_invalid`). */
export const POST_SERIES_MIN_DURATION_MINUTES = 15;
export const POST_SERIES_MAX_DURATION_MINUTES = 1440;

/** Weekdays use the shared Sunday-first numbering (`Date.getDay()`), as recurring rides do. */
export type PostSeriesWeekday = RideWeekday;

/** When a series runs. `startTime` is `HH:mm` in the series' time zone; `endsOn` is an ISO date or null. */
export interface PostSeriesSchedule {
  readonly weekdays: readonly PostSeriesWeekday[];
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly endsOn: string | null;
}

export interface PostSeries {
  readonly id: string;
  readonly title: string;
  /** Places of every date; null = unlimited. */
  readonly capacity: number | null;
  readonly schedule: PostSeriesSchedule;
  /** IANA zone the start time is read in, e.g. `Asia/Jerusalem`. */
  readonly timeZone: string;
  readonly status: PostSeriesStatus;
}

export interface CreatePostSeriesInput {
  readonly kindId: string;
  readonly title: string;
  readonly summary: string | null;
  /** The event form's details (capacity, policy, address, …), without its start and end. */
  readonly details: Record<string, unknown>;
  readonly cityId: string;
  readonly schedule: PostSeriesSchedule;
  readonly timeZone: string;
  /** The organization every date is published for; null for the member's own volunteering. */
  readonly orgId: string | null;
}

/** Edit all (FR-POST-024 AC5): the schedule; dates with registrations keep theirs. */
export interface UpdatePostSeriesInput {
  readonly schedule: PostSeriesSchedule;
}

/** What `create_post_series` hands back: the series and its soonest date's post to open. */
export interface CreatedPostSeries {
  readonly seriesId: string;
  readonly firstPostId: string;
}

/** One upcoming date of a series, as `list_post_series_occurrences` returns it. */
export interface PostSeriesOccurrence {
  readonly postId: string;
  /** The date's day, ISO date in the series' time zone. */
  readonly occurrenceOn: string;
  readonly startsAt: string;
}

/** The link a date carries to its series (`post_event_details.series_id / series_on`). */
export interface PostSeriesMarker {
  readonly id: string;
  /** The date's day, ISO date. */
  readonly on: string;
}

export type PostSeriesScheduleErrorCode =
  | 'series_weekdays_required'
  | 'series_time_invalid'
  | 'series_duration_invalid'
  | 'series_ends_in_past';

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first problem with a schedule, or null when it can be published: at least one weekday, a
 * valid `HH:mm`, a length the server accepts, and an end date not before `today` (ISO date).
 */
export function postSeriesScheduleError(schedule: PostSeriesSchedule, today: string): PostSeriesScheduleErrorCode | null {
  if (schedule.weekdays.length === 0 || !schedule.weekdays.every(isRideWeekday)) return 'series_weekdays_required';
  if (!TIME_HHMM.test(schedule.startTime)) return 'series_time_invalid';
  if (
    !Number.isInteger(schedule.durationMinutes)
    || schedule.durationMinutes < POST_SERIES_MIN_DURATION_MINUTES
    || schedule.durationMinutes > POST_SERIES_MAX_DURATION_MINUTES
  ) {
    return 'series_duration_invalid';
  }
  if (schedule.endsOn !== null && (!ISO_DATE.test(schedule.endsOn) || schedule.endsOn < today)) return 'series_ends_in_past';
  return null;
}

/** The series link of an event's details (`series_id`, `series_on`); null on a single event. */
export function readPostSeriesMarker(details: Record<string, unknown>): PostSeriesMarker | null {
  const id = details.series_id;
  const on = details.series_on;
  if (typeof id !== 'string' || typeof on !== 'string' || !ISO_DATE.test(on)) return null;
  return { id, on };
}
