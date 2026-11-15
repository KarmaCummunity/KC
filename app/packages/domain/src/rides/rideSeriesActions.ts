import { allowsMove } from '../fsm/machine';
import { rideSeriesMachine } from '../fsm/machines/rideSeries';

/** The actions the owner's list offers on one recurring ride (FR-RIDE-046 AC6). */
export interface RideSeriesActions {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly cancel: boolean;
}

/**
 * Derives a recurring ride's actions from `rideSeriesMachine`, so the list offers what
 * `set_ride_series_status` accepts: pause an active series, resume a paused one, cancel
 * either. A cancelled series, or a status the app does not know, offers nothing.
 */
export function rideSeriesActions(status: string): RideSeriesActions {
  return {
    pause: allowsMove(rideSeriesMachine, status, 'paused'),
    resume: allowsMove(rideSeriesMachine, status, 'active'),
    cancel: allowsMove(rideSeriesMachine, status, 'cancelled'),
  };
}
