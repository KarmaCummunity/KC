// Recurring time posts (`docs/spec/requirements/04_posts.md` FR-POST-024). The server owns the
// dates, the status machine and the owner check; these guard the schedule before the round trip
// and delegate.
import {
  PostSeriesError,
  localIsoDate,
  postSeriesScheduleError,
  type CreatePostSeriesInput,
  type CreatedPostSeries,
  type PostSeries,
  type PostSeriesOccurrence,
  type PostSeriesSchedule,
  type PostSeriesStatus,
  type UpdatePostSeriesInput,
} from '@kc/domain';
import type { IPostSeriesRepository } from '../ports/IPostSeriesRepository';

/** Rejects with the schedule's first problem (weekdays, time, length, end date) before calling the server. */
function assertSchedule(schedule: PostSeriesSchedule, now: Date): void {
  const code = postSeriesScheduleError(schedule, localIsoDate(now));
  if (code) throw new PostSeriesError(code, code);
}

export class CreatePostSeriesUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  async execute(input: CreatePostSeriesInput, now: Date = new Date()): Promise<CreatedPostSeries> {
    assertSchedule(input.schedule, now);
    return this.repo.create(input);
  }
}

export class ListMyPostSeriesUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  execute(): Promise<PostSeries[]> {
    return this.repo.listMine();
  }
}

/** Edit all (AC5): upcoming dates nobody registered for follow the new template and schedule. */
export class UpdatePostSeriesUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  async execute(seriesId: string, input: UpdatePostSeriesInput, now: Date = new Date()): Promise<void> {
    assertSchedule(input.schedule, now);
    return this.repo.update(seriesId, input);
  }
}

/** Pause, resume or end (AC7–AC9). Ending is final on the server; the UI hides the series afterwards. */
export class SetPostSeriesStatusUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  execute(seriesId: string, status: PostSeriesStatus): Promise<void> {
    return this.repo.setStatus(seriesId, status);
  }
}

/** Cancel one date (AC6): its registrants are told and the date is not published again. */
export class CancelPostSeriesOccurrenceUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  execute(postId: string): Promise<void> {
    return this.repo.cancelOccurrence(postId);
  }
}

/** "Other dates" on a date's post: the member picks the day they want and registers there. */
export class ListPostSeriesOccurrencesUseCase {
  constructor(private readonly repo: IPostSeriesRepository) {}
  execute(seriesId: string): Promise<PostSeriesOccurrence[]> {
    return this.repo.listOccurrences(seriesId);
  }
}
