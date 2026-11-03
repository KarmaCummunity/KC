import { describe, expect, it } from 'vitest';
import { isRideEmergencyWindow, rideCostShareCap } from '../rideSafety';

describe('rideCostShareCap', () => {
  it('caps a ride inside one city at ₪20 and between cities at ₪70', () => {
    expect(rideCostShareCap({ origin_city_id: '5000', dest_city_id: '5000' })).toBe(20);
    expect(rideCostShareCap({ origin_city_id: '5000', dest_city_id: '3000' })).toBe(70);
  });

  it('treats a ride without both cities (e.g. a junction) as intercity', () => {
    expect(rideCostShareCap({ dest_city_id: '5000' })).toBe(70);
  });
});

describe('isRideEmergencyWindow', () => {
  const departs = '2026-11-01T08:00:00Z';

  it('opens an hour before departure and closes two hours after the estimated end', () => {
    const ride = { departs_at: departs, arrives_at: '2026-11-01T09:00:00Z' };
    expect(isRideEmergencyWindow(ride, new Date('2026-11-01T06:59:00Z'))).toBe(false);
    expect(isRideEmergencyWindow(ride, new Date('2026-11-01T07:00:00Z'))).toBe(true);
    expect(isRideEmergencyWindow(ride, new Date('2026-11-01T11:00:00Z'))).toBe(true);
    expect(isRideEmergencyWindow(ride, new Date('2026-11-01T11:01:00Z'))).toBe(false);
  });

  it('without an estimated end, stays open until 8 hours after departure', () => {
    expect(isRideEmergencyWindow({ departs_at: departs }, new Date('2026-11-01T16:00:00Z'))).toBe(true);
    expect(isRideEmergencyWindow({ departs_at: departs }, new Date('2026-11-01T16:01:00Z'))).toBe(false);
  });

  it('is closed for a ride without a departure', () => {
    expect(isRideEmergencyWindow({}, new Date())).toBe(false);
  });
});
