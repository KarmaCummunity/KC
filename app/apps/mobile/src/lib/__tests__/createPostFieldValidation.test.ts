import { describe, it, expect, vi } from 'vitest';

vi.mock('../../i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `[t:${key}|${JSON.stringify(params)}]` : `[t:${key}]`,
  },
}));

import {
  buildAddressInlineErrorMessage,
  buildCreatePostNonAddressToastMessage,
  getAddressValidationIssue,
  hasAddressRequiredFieldGaps,
  hasNonAddressRequiredFieldGaps,
  isStreetMissing,
  isStreetNumberMissing,
} from '../createPostFieldValidation';

const COMPLETE = {
  isGive: true,
  title: 'Sofa',
  city: { id: 'IL-001', name: 'Lod' },
  street: 'Main',
  streetNumber: '12',
  uploadsLength: 1,
};

describe('getAddressValidationIssue', () => {
  it('returns none when city, street, and number are set', () => {
    expect(getAddressValidationIssue(COMPLETE.city, COMPLETE.street, COMPLETE.streetNumber)).toBe(
      'none',
    );
  });

  it('returns city when city is null', () => {
    expect(getAddressValidationIssue(null, 'Main', '12')).toBe('city');
  });

  it('returns street when street is blank', () => {
    expect(getAddressValidationIssue(COMPLETE.city, '  ', '12')).toBe('street');
  });

  it('returns streetNumber when number is blank', () => {
    expect(getAddressValidationIssue(COMPLETE.city, 'Main', '')).toBe('streetNumber');
  });

  it('returns streetAndNumber when both street and number are blank', () => {
    expect(getAddressValidationIssue(COMPLETE.city, '', '')).toBe('streetAndNumber');
  });
});

describe('buildAddressInlineErrorMessage', () => {
  it('maps each issue to the matching i18n key', () => {
    expect(buildAddressInlineErrorMessage('street')).toContain('missingStreetBeforePublish');
    expect(buildAddressInlineErrorMessage('streetNumber')).toContain(
      'missingStreetNumberBeforePublish',
    );
    expect(buildAddressInlineErrorMessage('streetAndNumber')).toContain(
      'missingAddressPairBeforePublish',
    );
    expect(buildAddressInlineErrorMessage('city')).toContain('missingCityBeforePublish');
  });

  it('returns empty string for none issue', () => {
    expect(buildAddressInlineErrorMessage('none')).toBe('');
  });
});

describe('buildCreatePostNonAddressToastMessage', () => {
  it('returns "" when only address fields are incomplete', () => {
    expect(
      buildCreatePostNonAddressToastMessage({
        ...COMPLETE,
        city: null,
        street: '',
        streetNumber: '',
      }),
    ).toBe('');
  });

  it('surfaces title when missing', () => {
    const out = buildCreatePostNonAddressToastMessage({ ...COMPLETE, title: '' });
    expect(out).toContain('missingOne');
    expect(out).toContain('fieldTitle');
  });

  it('surfaces photo for Give when missing', () => {
    const out = buildCreatePostNonAddressToastMessage({ ...COMPLETE, uploadsLength: 0 });
    expect(out).toContain('fieldPhoto');
  });

  it('surfaces multiple missing fields with missingMany when both title and photo are missing', () => {
    const out = buildCreatePostNonAddressToastMessage({
      ...COMPLETE,
      title: '',
      uploadsLength: 0,
      isGive: true,
    });
    expect(out).toContain('missingMany');
    expect(out).toContain('fieldTitle');
    expect(out).toContain('fieldPhoto');
  });
});

describe('hasNonAddressRequiredFieldGaps', () => {
  it('returns true when title is empty', () => {
    expect(hasNonAddressRequiredFieldGaps({ ...COMPLETE, title: '' })).toBe(true);
  });

  it('returns true when isGive is true and photo uploadsLength is 0', () => {
    expect(hasNonAddressRequiredFieldGaps({ ...COMPLETE, uploadsLength: 0 })).toBe(true);
  });

  it('returns false when Request post has no photo uploads', () => {
    expect(hasNonAddressRequiredFieldGaps({ ...COMPLETE, isGive: false, uploadsLength: 0 })).toBe(false);
  });

  it('returns false when complete', () => {
    expect(hasNonAddressRequiredFieldGaps(COMPLETE)).toBe(false);
  });
});

describe('isStreetMissing and isStreetNumberMissing', () => {
  it('detects blank or whitespace street', () => {
    expect(isStreetMissing({ ...COMPLETE, street: '' })).toBe(true);
    expect(isStreetMissing({ ...COMPLETE, street: '   ' })).toBe(true);
    expect(isStreetMissing(COMPLETE)).toBe(false);
  });

  it('detects blank or whitespace streetNumber', () => {
    expect(isStreetNumberMissing({ ...COMPLETE, streetNumber: '' })).toBe(true);
    expect(isStreetNumberMissing({ ...COMPLETE, streetNumber: '   ' })).toBe(true);
    expect(isStreetNumberMissing(COMPLETE)).toBe(false);
  });
});

describe('hasAddressRequiredFieldGaps', () => {
  it('is true when any address part is missing', () => {
    expect(hasAddressRequiredFieldGaps(null, 'Main', '1')).toBe(true);
    expect(hasAddressRequiredFieldGaps(COMPLETE.city, '', '1')).toBe(true);
  });
});
