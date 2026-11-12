import type {
  CreatePostSeriesInput,
  CreatedPostSeries,
  PostSeries,
  PostSeriesOccurrence,
  PostSeriesStatus,
  UpdatePostSeriesInput,
} from '@kc/domain';

/** The caller's recurring time posts (`docs/spec/requirements/04_posts.md` FR-POST-024). */
export interface IPostSeriesRepository {
  /** The caller's series that have not ended, oldest first. */
  listMine(): Promise<PostSeries[]>;
  /** Publishes the series and its first dates; resolves to the series and its soonest date's post. */
  create(input: CreatePostSeriesInput): Promise<CreatedPostSeries>;
  /** Edit all: the schedule changes; dates nobody registered for are published again, registered dates keep theirs. */
  update(seriesId: string, input: UpdatePostSeriesInput): Promise<void>;
  /** Pause, resume or end. Ending cancels every upcoming date and tells its registrants. */
  setStatus(seriesId: string, status: PostSeriesStatus): Promise<void>;
  /** Cancels one upcoming date, by its post; its registrants are told and it is not published again. */
  cancelOccurrence(postId: string): Promise<void>;
  /** The upcoming open dates of a series the caller may see, soonest first (public read). */
  listOccurrences(seriesId: string): Promise<PostSeriesOccurrence[]>;
}
