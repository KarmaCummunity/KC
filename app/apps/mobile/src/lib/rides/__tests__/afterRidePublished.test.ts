import { beforeEach, describe, expect, it, vi } from 'vitest';

const { save, remember, navigate } = vi.hoisted(() => ({
  save: vi.fn(),
  remember: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('../../../services/rideHouseNumberComposition', () => ({
  rideHouseNumberUseCases: { save: () => ({ execute: save }) },
}));
vi.mock('../rideStartDetails', () => ({ rememberRideRoute: remember }));
vi.mock('../navigateAfterRidePublish', () => ({ navigateAfterRidePublish: navigate }));

import { afterRidePublished } from '../afterRidePublished';

const details = {
  origin_place_kind: 'city', origin_place_id: '5000', origin_label: 'תל אביב - יפו', origin_lat: 32.08, origin_lng: 34.78, origin_city_id: '5000',
  dest_place_kind: 'street', dest_place_id: '4000:9', dest_label: 'הנמל, חיפה', dest_lat: 32.79, dest_lng: 34.99, dest_city_id: '4000',
};
const flags = { isOffer: true, originFromHere: true, leaveNow: true, recurring: false };

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue(undefined);
});

describe('afterRidePublished (FR-RIDE-003 AC8, AC9)', () => {
  it('saves only street-end numbers, remembers the route and navigates with the number', async () => {
    await afterRidePublished('L1', details, { origin: '3', dest: ' 7 ' }, flags);
    expect(save).toHaveBeenCalledWith('L1', { dest: '7' });
    expect(remember).toHaveBeenCalledWith(details);
    expect(navigate).toHaveBeenCalledWith(details, flags, { dest: '7' });
  });

  it('skips saving when there is nothing to save', async () => {
    await afterRidePublished('L1', details, {}, flags);
    expect(save).not.toHaveBeenCalled();
  });

  it('carries on when saving fails', async () => {
    save.mockRejectedValueOnce(new Error('network'));
    await expect(afterRidePublished('L1', details, { dest: '7' }, flags)).resolves.toBeUndefined();
    expect(navigate).toHaveBeenCalled();
  });
});
