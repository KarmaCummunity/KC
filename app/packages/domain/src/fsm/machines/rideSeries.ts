import { RIDE_SERIES_STATUSES } from '../../rides/RideSeries';
import { defineMachine } from '../machine';

/**
 * Recurring ride lifecycle (`ride_series.status`; spec `docs/spec/requirements/15_rides.md`
 * FR-RIDE-046 AC6).
 *
 * - The owner pauses and resumes a series (`set_ride_series_status`).
 * - Cancelling, from either state, is final (`ride_series_cancelled`): the owner publishes a new
 *   series instead.
 *
 * SQL copy: `supabase/migrations/0719_fsm_recurring.sql`.
 */
export const rideSeriesMachine = defineMachine({
  id: 'ride_series',
  states: RIDE_SERIES_STATUSES,
  edges: [
    { from: 'active', to: 'paused' },
    { from: 'paused', to: 'active' },
    { from: 'active', to: 'cancelled' },
    { from: 'paused', to: 'cancelled' },
  ],
});
