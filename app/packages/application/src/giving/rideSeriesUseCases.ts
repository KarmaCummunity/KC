// Recurring rides (docs/spec/05_giving_worlds.md §5.3 step 1, FR-RIDE-046). The server owns
// the occurrences, the status machine and the owner check; these guard the schedule before the
// round trip and delegate.
import {
  RideError,
  localIsoDate,
  rideSeriesScheduleError,
  type CreateRideSeriesInput,
  type CreatedRideSeries,
  type RideSeries,
  type RideSeriesSchedule,
  type RideSeriesStatus,
} from '@kc/domain';
import type { IRideSeriesRepository } from '../ports/IRideSeriesRepository';

/** Rejects with the schedule's first problem (weekdays, time, end date) before calling the server. */
function assertSchedule(schedule: RideSeriesSchedule, now: Date): void {
  const code = rideSeriesScheduleError(schedule, localIsoDate(now));
  if (code) throw new RideError(code, code);
}

export class CreateRideSeriesUseCase {
  constructor(private readonly repo: IRideSeriesRepository) {}
  async execute(input: CreateRideSeriesInput, now: Date = new Date()): Promise<CreatedRideSeries> {
    assertSchedule(input.schedule, now);
    return this.repo.create(input);
  }
}

export class ListMyRideSeriesUseCase {
  constructor(private readonly repo: IRideSeriesRepository) {}
  execute(): Promise<RideSeries[]> {
    return this.repo.listMine();
  }
}

/** Pause, resume or cancel. Cancelling is terminal on the server; the UI hides it afterwards. */
export class SetRideSeriesStatusUseCase {
  constructor(private readonly repo: IRideSeriesRepository) {}
  execute(seriesId: string, status: RideSeriesStatus): Promise<void> {
    return this.repo.setStatus(seriesId, status);
  }
}

export class UpdateRideSeriesScheduleUseCase {
  constructor(private readonly repo: IRideSeriesRepository) {}
  async execute(
    seriesId: string,
    schedule: RideSeriesSchedule,
    durationMinutes: number | null,
    now: Date = new Date(),
  ): Promise<void> {
    assertSchedule(schedule, now);
    return this.repo.updateSchedule(seriesId, schedule, durationMinutes);
  }
}
