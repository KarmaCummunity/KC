import { describe, expect, it } from 'vitest';
import { externalBodyLabel, matchExternalBody, type ExternalBodyOption } from '../externalBodies';
import { mapMarketplaceServerError, validateMarketplaceWorldRules } from '../marketplaceWorldRules';

const spca: ExternalBodyOption = {
  bodyId: 'b1',
  slug: 'spca_israel',
  worldSlug: 'animals',
  labelHe: 'צער בעלי חיים בישראל',
  labelEn: 'SPCA Israel',
  bodyType: 'ngo',
  contactUrl: null,
};

describe('externalBodyLabel', () => {
  it('picks the label for the UI language', () => {
    expect(externalBodyLabel(spca, 'he')).toBe('צער בעלי חיים בישראל');
    expect(externalBodyLabel(spca, 'he-IL')).toBe('צער בעלי חיים בישראל');
    expect(externalBodyLabel(spca, 'en')).toBe('SPCA Israel');
  });
  it('falls back when one label is blank', () => {
    expect(externalBodyLabel({ ...spca, labelEn: ' ' }, 'en')).toBe('צער בעלי חיים בישראל');
    expect(externalBodyLabel({ ...spca, labelHe: '' }, 'he')).toBe('SPCA Israel');
  });
});

describe('matchExternalBody', () => {
  it('matches he, en (case-insensitive) and slug', () => {
    expect(matchExternalBody(spca, 'בעלי')).toBe(true);
    expect(matchExternalBody(spca, 'spca')).toBe(true);
    expect(matchExternalBody(spca, 'ISRAEL')).toBe(true);
    expect(matchExternalBody(spca, 'israel')).toBe(true);
    expect(matchExternalBody(spca, 'mda')).toBe(false);
    expect(matchExternalBody(spca, '  ')).toBe(true);
  });
});

describe('routed worlds with a picked organisation', () => {
  it('passes the client rule once an external body is selected', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'environment', direction: 'give', details: {}, photoCount: 0 })).toBe(
      'routed_world_requires_external_body',
    );
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'environment', direction: 'give', details: {}, photoCount: 0, externalBodyId: spca.bodyId }),
    ).toBeNull();
  });
  it('maps the new server codes', () => {
    expect(mapMarketplaceServerError({ message: 'external_body_invalid' })).toBe('external_body_invalid');
    expect(mapMarketplaceServerError({ code: '42501', message: 'world_permission_denied' })).toBe(
      'world_permission_denied',
    );
    expect(mapMarketplaceServerError({ message: 'medical_listing_requires_external_body' })).toBe(
      'medical_listing_requires_external_body',
    );
  });
});
