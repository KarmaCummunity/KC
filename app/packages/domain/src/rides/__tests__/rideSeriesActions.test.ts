import { describe, expect, it } from 'vitest';
import { rideSeriesActions } from '../rideSeriesActions';

describe('rideSeriesActions (ride_series machine, FR-RIDE-046 AC6)', () => {
  it('pauses or cancels an active series', () => {
    expect(rideSeriesActions('active')).toEqual({ pause: true, resume: false, cancel: true });
  });

  it('resumes or cancels a paused series', () => {
    expect(rideSeriesActions('paused')).toEqual({ pause: false, resume: true, cancel: true });
  });

  it('offers nothing on a cancelled series or on a status it does not know', () => {
    expect(rideSeriesActions('cancelled')).toEqual({ pause: false, resume: false, cancel: false });
    expect(rideSeriesActions('archived')).toEqual({ pause: false, resume: false, cancel: false });
  });
});
