import { beforeEach, describe, expect, it, vi } from 'vitest';

const openURL = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Linking: { openURL } }));

import { navigateAfterRidePublish } from '../navigateAfterRidePublish';

const details = {
  origin_place_kind: 'city', origin_place_id: '5000', origin_label: 'תל אביב - יפו', origin_lat: 32.08, origin_lng: 34.78, origin_city_id: '5000',
  dest_place_kind: 'city', dest_place_id: '4000', dest_label: 'חיפה', dest_lat: 32.79, dest_lng: 34.99, dest_city_id: '4000',
};
const flags = { isOffer: true, originFromHere: true, leaveNow: true, recurring: false };

beforeEach(() => openURL.mockReset().mockResolvedValue(true));

describe('navigateAfterRidePublish (FR-RIDE-003 AC8)', () => {
  it('opens Waze navigating to the destination of an offer leaving now from here', async () => {
    await expect(navigateAfterRidePublish(details, flags)).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://waze.com/ul?ll=32.79,34.99&navigate=yes');
  });

  it('does nothing when the ride does not leave now from here', async () => {
    await expect(navigateAfterRidePublish(details, { ...flags, leaveNow: false })).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('navigates to the exact address of a destination street with its house number', async () => {
    const street = { ...details, dest_place_kind: 'street', dest_place_id: '4000:9', dest_label: 'הנמל, חיפה' };
    await navigateAfterRidePublish(street, flags, { dest: '7' });
    expect(openURL).toHaveBeenCalledWith(`https://waze.com/ul?q=${encodeURIComponent('הנמל 7, חיפה')}&navigate=yes`);
  });

  it('swallows a failure to open the link', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(navigateAfterRidePublish(details, flags)).resolves.toBe(false);
  });
});
