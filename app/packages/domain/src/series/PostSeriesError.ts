import { DomainError } from '../errors';
import type { PostSeriesScheduleErrorCode } from './PostSeries';

/**
 * A recurring event's schedule was refused before the round trip (FR-POST-024). Refusals of the
 * server itself arrive as `BackendRuleError` with the server's code (`post_series_not_found`,
 * `post_series_schedule_invalid`, `post_series_no_occurrence`, `post_series_date_started`).
 */
export class PostSeriesError extends DomainError {
  readonly code: PostSeriesScheduleErrorCode;

  constructor(code: PostSeriesScheduleErrorCode, message: string) {
    super(message, { code });
    this.code = code;
  }
}
