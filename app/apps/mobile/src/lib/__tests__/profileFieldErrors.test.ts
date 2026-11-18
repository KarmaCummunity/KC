// FR-PROFILE-007 / FR-AUTH-010 / FR-RESP-006 AC29 — each profile-form problem belongs to one field.
import { describe, expect, it } from 'vitest';
import { profileFieldErrors, isProfileValid, type ProfileFieldValues } from '../profileFieldErrors';

const t = (key: string) => key;
const NOW = new Date('2026-06-01T12:00:00Z');
const valid: ProfileFieldValues = {
  displayName: 'Dana',
  cityId: '5000',
  street: '',
  streetNumber: '',
  contactPhone: '',
  dateOfBirth: null,
  dateOfBirthChanged: false,
};
const errorsOf = (patch: Partial<ProfileFieldValues>) => profileFieldErrors({ ...valid, ...patch }, t, NOW);

describe('profileFieldErrors', () => {
  it('finds nothing wrong with a named profile in a city', () => {
    expect(isProfileValid(errorsOf({}))).toBe(true);
  });

  it('marks an empty or too long name on the name field', () => {
    expect(errorsOf({ displayName: '   ' })).toEqual({ displayName: 'profile.editScreen.invalidNameMessage' });
    expect(errorsOf({ displayName: 'x'.repeat(51) }).displayName).toBe('profile.editScreen.invalidNameMessage');
  });

  it('marks a missing city, or half an address, on the address', () => {
    expect(errorsOf({ cityId: null })).toEqual({ address: 'profile.editScreen.missingCityMessage' });
    expect(errorsOf({ street: 'Herzl' }).address).toBe('profile.editScreen.incompleteAddressMessageNumber');
    expect(errorsOf({ streetNumber: '12' }).address).toBe('profile.editScreen.incompleteAddressMessageStreet');
    expect(isProfileValid(errorsOf({ street: 'Herzl', streetNumber: '12' }))).toBe(true);
    // The server's house-number format holds here too.
    expect(errorsOf({ street: 'Herzl', streetNumber: '12-A' }).address).toBe('errors.profile.invalid_profile_street_number');
  });

  it('marks a phone longer than the profile accepts', () => {
    expect(errorsOf({ contactPhone: '0'.repeat(21) })).toEqual({ contactPhone: 'profile.editScreen.invalidContactPhoneMessage' });
  });

  it('checks the date of birth only once it was changed', () => {
    expect(isProfileValid(errorsOf({ dateOfBirth: null }))).toBe(true);
    expect(errorsOf({ dateOfBirthChanged: true, dateOfBirth: null }).dateOfBirth).toBe('dateOfBirth.errors.invalid');
    expect(errorsOf({ dateOfBirthChanged: true, dateOfBirth: '2015-01-01' }).dateOfBirth).toBe('dateOfBirth.errors.underage');
    expect(isProfileValid(errorsOf({ dateOfBirthChanged: true, dateOfBirth: '1990-04-12' }))).toBe(true);
  });

  it('reports every field with a problem at once, so the form can jump to the first', () => {
    expect(Object.keys(errorsOf({ displayName: '', cityId: null, contactPhone: '0'.repeat(21) })).sort()).toEqual([
      'address',
      'contactPhone',
      'displayName',
    ]);
  });
});
