// FR-POST-024 — the copy key of a refused recurring-event action; null when the error is not a
// series refusal, so the caller falls back to its own mapping.
import { BackendRuleError, PostSeriesError, type PostSeriesScheduleErrorCode } from '@kc/domain';

/** Schedule problems found before the round trip. */
const SCHEDULE_KEYS: Record<PostSeriesScheduleErrorCode, string> = {
  series_weekdays_required: 'postSeries.errors.weekdaysRequired',
  series_time_invalid: 'postSeries.errors.scheduleInvalid',
  series_duration_invalid: 'postSeries.errors.durationInvalid',
  series_ends_in_past: 'postSeries.errors.endsInPast',
};

/** The server's own refusals (`0003_post_series.sql`, `0004_post_series_rpcs.sql`), by reason. */
const SERVER_KEYS: Readonly<Record<string, string>> = {
  post_series_schedule_invalid: 'postSeries.errors.scheduleInvalid',
  post_series_no_occurrence: 'postSeries.errors.noOccurrence',
  post_series_not_found: 'postSeries.errors.ended',
  post_series_date_started: 'postSeries.errors.occurrenceStarted',
  illegal_transition: 'postSeries.errors.ended',
  forbidden: 'postSeries.errors.orgRequired',
};

export function postSeriesErrorKey(error: unknown): string | null {
  if (error instanceof PostSeriesError) return SCHEDULE_KEYS[error.code];
  if (error instanceof BackendRuleError) return SERVER_KEYS[error.reason] ?? null;
  return null;
}
