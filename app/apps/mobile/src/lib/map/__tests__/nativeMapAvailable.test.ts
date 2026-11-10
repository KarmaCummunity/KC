// #1951: Android builds without a Google Maps key must not mount MapView (the SDK throws).
import { describe, expect, it } from 'vitest';
import { isNativeMapAvailable } from '../nativeMapAvailable';

describe('isNativeMapAvailable', () => {
  it('blocks the Android map when the build has no Google Maps key', () => {
    expect(isNativeMapAvailable('android', { googleMapsConfigured: false })).toBe(false);
    expect(isNativeMapAvailable('android', {})).toBe(false);
    expect(isNativeMapAvailable('android', undefined)).toBe(false);
  });

  it('allows the Android map when the build has a key', () => {
    expect(isNativeMapAvailable('android', { googleMapsConfigured: true })).toBe(true);
  });

  it('only accepts a real boolean flag', () => {
    expect(isNativeMapAvailable('android', { googleMapsConfigured: 'true' })).toBe(false);
  });

  it('never blocks iOS, which uses Apple Maps without a key', () => {
    expect(isNativeMapAvailable('ios', undefined)).toBe(true);
  });
});
