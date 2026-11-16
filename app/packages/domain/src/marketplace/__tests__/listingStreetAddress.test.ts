import { describe, expect, it } from 'vitest';
import { listingStreetAddressIssue, listingStreetAddressLabel } from '../listingStreetAddress';

describe('listingStreetAddressIssue', () => {
  it('accepts a street with a house number, with or without a letter', () => {
    expect(listingStreetAddressIssue({ street: 'הרצל', streetNumber: '12' })).toBeNull();
    expect(listingStreetAddressIssue({ street: ' Herzl ', streetNumber: ' 12B ' })).toBeNull();
    expect(listingStreetAddressIssue({ street: 'הרצל', streetNumber: '7א' })).toBeNull();
  });

  it('names the missing part', () => {
    expect(listingStreetAddressIssue({ street: ' ', streetNumber: '' })).toBe('streetAndNumber');
    expect(listingStreetAddressIssue({ street: '', streetNumber: '12' })).toBe('street');
    expect(listingStreetAddressIssue({ street: 'הרצל', streetNumber: ' ' })).toBe('streetNumber');
  });

  it('refuses a house number the database would refuse', () => {
    expect(listingStreetAddressIssue({ street: 'הרצל', streetNumber: 'abc' })).toBe('streetNumberInvalid');
    expect(listingStreetAddressIssue({ street: 'הרצל', streetNumber: '12-14' })).toBe('streetNumberInvalid');
  });
});

describe('listingStreetAddressLabel', () => {
  it('joins the trimmed parts into one line', () => {
    expect(listingStreetAddressLabel({ street: ' הרצל ', streetNumber: ' 12 ' })).toBe('הרצל 12');
  });

  it('is the street alone when there is no number', () => {
    expect(listingStreetAddressLabel({ street: 'הרצל', streetNumber: '' })).toBe('הרצל');
  });
});
