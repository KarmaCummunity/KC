import type {
  CreateRideSeriesInput,
  CreatedRideSeries,
  RideSeries,
  RideSeriesOccurrence,
  RideSeriesSchedule,
  RideSeriesStatus,
} from '@kc/domain';

/** The caller's recurring rides (docs/spec/05_giving_worlds.md §5.3 step 1, FR-RIDE-046). */
export interface IRideSeriesRepository {
  listMine(): Promise<RideSeries[]>;
  /** Publishes the series and its first occurrences; resolves to the series and the soonest ride. */
  create(input: CreateRideSeriesInput): Promise<CreatedRideSeries>;
  setStatus(seriesId: string, status: RideSeriesStatus): Promise<void>;
  updateSchedule(seriesId: string, schedule: RideSeriesSchedule, durationMinutes: number | null): Promise<void>;
  /** The upcoming open occurrences of a series the caller may see, soonest first (public read). */
  listOccurrences(seriesId: string): Promise<RideSeriesOccurrence[]>;
}
