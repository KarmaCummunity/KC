import { describe, expect, it } from 'vitest';
import {
  effectiveVerificationLevel,
  isProfileComplete,
  missingCompleteProfileFields,
  toVerificationLevel,
  type CompleteProfileFields,
} from '../verificationLevel';

const complete: CompleteProfileFields = {
  displayName: 'נוה',
  city: 'tel-aviv',
  dateOfBirth: '1990-01-01',
  avatarUrl: 'https://example.test/a.png',
  profileStreet: 'הרצל',
  profileStreetNumber: '12',
  contactPhone: '0501234567',
};

describe('isProfileComplete', () => {
  it('is true when every required field is filled', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(missingCompleteProfileFields(complete)).toEqual([]);
  });

  it.each(Object.keys(complete) as (keyof CompleteProfileFields)[])('is false when %s is missing', (key) => {
    const fields = { ...complete, [key]: null };
    expect(isProfileComplete(fields)).toBe(false);
    expect(missingCompleteProfileFields(fields)).toEqual([key]);
  });

  it('treats whitespace-only values as missing', () => {
    expect(missingCompleteProfileFields({ ...complete, contactPhone: '   ' })).toEqual(['contactPhone']);
  });
});

describe('effectiveVerificationLevel', () => {
  it('shows level 1 when every field is filled but the column is still 0', () => {
    expect(effectiveVerificationLevel({ ...complete, verificationLevel: 0 })).toBe(1);
  });

  it('keeps server levels 2 and above', () => {
    expect(effectiveVerificationLevel({ ...complete, verificationLevel: 2 })).toBe(2);
  });

  it('stays 0 when a required field is missing', () => {
    expect(
      effectiveVerificationLevel({ ...complete, dateOfBirth: null, verificationLevel: 0 }),
    ).toBe(0);
  });
});

describe('toVerificationLevel', () => {
  it('keeps valid levels', () => {
    expect([0, 1, 2, 3].map(toVerificationLevel)).toEqual([0, 1, 2, 3]);
  });

  it('maps anything else to 0', () => {
    expect([null, undefined, 4, -1, '2', 1.5].map(toVerificationLevel)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
