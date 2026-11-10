import { describe, expect, it } from 'vitest';
import type { RidePlace } from '../RidePlace';
import {
  hasInvalidRideHouseNumber,
  isValidRideHouseNumber,
  rideAddressLabel,
  rideHouseNumbersForSubmit,
} from '../rideHouseNumbers';

const STREET: RidePlace = { kind: 'street', id: '5000:12', label: 'הרצל, תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };
const CITY: RidePlace = { kind: 'city', id: '3000', label: 'ירושלים', lat: 31.78, lng: 35.22, cityId: '3000' };

describe('isValidRideHouseNumber', () => {
  it.each(['12', '7א', '120B', ' 4 '])('accepts %s', (v) => expect(isValidRideHouseNumber(v)).toBe(true));
  it.each(['', 'abc', '12345', '12-14', '12; drop'])('rejects %s', (v) => expect(isValidRideHouseNumber(v)).toBe(false));
});

describe('rideHouseNumbersForSubmit', () => {
  it('keeps trimmed valid numbers on street ends only', () => {
    const route = { origin: STREET, dest: CITY, meetingPoints: [] };
    expect(rideHouseNumbersForSubmit(route, { origin: ' 12 ', dest: '5' })).toEqual({ origin: '12' });
  });

  it('drops invalid and blank numbers', () => {
    const route = { origin: STREET, dest: STREET, meetingPoints: [] };
    expect(rideHouseNumbersForSubmit(route, { origin: 'x', dest: '  ' })).toEqual({});
  });
});

describe('hasInvalidRideHouseNumber', () => {
  it('flags a typed invalid number but not a blank one', () => {
    expect(hasInvalidRideHouseNumber({ origin: 'abc' })).toBe(true);
    expect(hasInvalidRideHouseNumber({ origin: ' ', dest: '9' })).toBe(false);
  });
});

describe('rideAddressLabel', () => {
  it('puts the number after the street', () => {
    expect(rideAddressLabel(STREET, '12')).toBe('הרצל 12, תל אביב - יפו');
  });

  it('keeps the label for other places or no number', () => {
    expect(rideAddressLabel(CITY, '12')).toBe('ירושלים');
    expect(rideAddressLabel(STREET, null)).toBe('הרצל, תל אביב - יפו');
  });
});
