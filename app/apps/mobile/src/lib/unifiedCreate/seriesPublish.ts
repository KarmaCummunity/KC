// The create form's two recurring publishes: a recurring ride (FR-RIDE-046) and an organization's
// recurring event (FR-POST-024). Each turns the form's single-post details into the series the
// server materializes, and resolves to the first date's listing id for the form to open.
import {
  POST_SERIES_MAX_DURATION_MINUTES,
  POST_SERIES_MIN_DURATION_MINUTES,
  localIsoDate,
  localTimeHHmm,
  rideDurationMinutes,
  type CreatePostSeriesInput,
} from '@kc/domain';
import type { RideRecurrenceDraft } from '../../components/giving/RideRecurrenceFields';
import { postSeriesUseCases } from '../../services/postSeriesComposition';
import { rideSeriesUseCases } from '../../services/rideSeriesComposition';

/** What both publishes read from the form. `submitted` is the single post's validated details. */
export interface SeriesPublishArgs {
  readonly kindId: string;
  readonly title: string;
  readonly summary: string;
  readonly submitted: Record<string, unknown>;
  readonly draft: RideRecurrenceDraft;
}

/** A recurring ride: the departure field's time of day is the series time; its day is only the first ride. */
export async function publishRideSeries(args: SeriesPublishArgs, direction: 'give' | 'request'): Promise<string> {
  const { departs_at: departsAt, arrives_at: _arrivesAt, ...template } = args.submitted;
  const created = await rideSeriesUseCases.create().execute({
    kindId: args.kindId,
    direction,
    title: args.title,
    summary: args.summary.trim() || null,
    details: template,
    schedule: {
      weekdays: args.draft.weekdays,
      time: localTimeHHmm(new Date(String(departsAt))),
      endsOn: args.draft.endsOn ? localIsoDate(args.draft.endsOn) : null,
    },
    durationMinutes: rideDurationMinutes(args.submitted),
  });
  return created.firstListingId;
}

/** Whole minutes between an event's start and end; null when either is missing or not a date. */
export function eventDurationMinutes(details: Record<string, unknown>): number | null {
  const startsAt = details.starts_at;
  const endsAt = details.ends_at;
  const starts = Date.parse(typeof startsAt === 'string' ? startsAt : '');
  const ends = Date.parse(typeof endsAt === 'string' ? endsAt : '');
  if (Number.isNaN(starts) || Number.isNaN(ends)) return null;
  return Math.round((ends - starts) / 60_000);
}

/** True when one date of the event has a length a series accepts (15 minutes to 24 hours). */
export function isEventSeriesDuration(details: Record<string, unknown>): boolean {
  const minutes = eventDurationMinutes(details);
  return minutes !== null && minutes >= POST_SERIES_MIN_DURATION_MINUTES && minutes <= POST_SERIES_MAX_DURATION_MINUTES;
}

/** The device's IANA time zone, which the start time is read in; Israel when it is unknown. */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
}

/**
 * The series of an organization's event: the start field's time of day and the event's length
 * repeat on the picked weekdays; the start field's day is only the first date. The template keeps
 * the capacity, policy and address, never the times; the organization travels beside it.
 */
export function eventSeriesInput(args: SeriesPublishArgs, cityId: string, timeZone: string): CreatePostSeriesInput {
  const { starts_at: startsAt, ends_at: _endsAt, org_id: orgId, ...template } = args.submitted;
  return {
    kindId: args.kindId,
    title: args.title,
    summary: args.summary.trim() || null,
    details: template,
    cityId,
    schedule: {
      weekdays: args.draft.weekdays,
      startTime: localTimeHHmm(new Date(String(startsAt))),
      durationMinutes: eventDurationMinutes(args.submitted) ?? 0,
      endsOn: args.draft.endsOn ? localIsoDate(args.draft.endsOn) : null,
    },
    timeZone,
    orgId: typeof orgId === 'string' ? orgId : null,
  };
}

/** Publishes the event series; a date's listing id is its post id. */
export async function publishEventSeries(args: SeriesPublishArgs, cityId: string): Promise<string> {
  const created = await postSeriesUseCases.create().execute(eventSeriesInput(args, cityId, deviceTimeZone()));
  return created.firstPostId;
}
