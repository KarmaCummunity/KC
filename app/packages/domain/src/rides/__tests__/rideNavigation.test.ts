import { describe, expect, it } from 'vitest';
import { rideNavigationAppsFor, rideNavigationUrl } from '../rideNavigation';
import type { RidePlace } from '../RidePlace';

const JUNCTION: RidePlace = { kind: 'junction', id: '106', label: 'Glilot West', lat: 32.1408, lng: 34.8013, cityId: null };
const STREET: RidePlace = { kind: 'street', id: '5000:404', label: 'Dizengoff, Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };

describe('rideNavigationUrl', () => {
  it('navigates to a junction by its coordinates', () => {
    expect(rideNavigationUrl('waze', JUNCTION)).toBe('https://waze.com/ul?ll=32.1408,34.8013&navigate=yes');
    expect(rideNavigationUrl('google', JUNCTION)).toBe('https://www.google.com/maps/dir/?api=1&destination=32.1408,34.8013');
    expect(rideNavigationUrl('apple', JUNCTION)).toBe('https://maps.apple.com/?daddr=32.1408,34.8013');
  });

  it('navigates to a street by its address, since its pin is only the city centre', () => {
    const address = encodeURIComponent('Dizengoff, Tel Aviv');
    expect(rideNavigationUrl('waze', STREET)).toBe(`https://waze.com/ul?q=${address}&navigate=yes`);
    expect(rideNavigationUrl('google', STREET)).toBe(`https://www.google.com/maps/dir/?api=1&destination=${address}`);
    expect(rideNavigationUrl('apple', STREET)).toBe(`https://maps.apple.com/?daddr=${address}`);
  });
});

describe('rideNavigationAppsFor', () => {
  it('offers Apple Maps only on iOS', () => {
    expect(rideNavigationAppsFor('ios')).toEqual(['waze', 'google', 'apple']);
    expect(rideNavigationAppsFor('android')).toEqual(['waze', 'google']);
    expect(rideNavigationAppsFor('web')).toEqual(['waze', 'google']);
  });
});
