// #1412 regression: ride cards showed the raw key `cards.passengers`. The app's i18n runs with
// `compatibilityJSON: 'v3'`, so the `_one` / `_other` plural suffixes of the `cards` copy never
// resolve from the base key; `rideSeatCountKey` picks the plural form explicitly.
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '../index';
import { rideSeatCountKey } from '../../lib/rideSeatCountKey';

const originalLanguage = i18n.language;
afterAll(() => i18n.changeLanguage(originalLanguage));

describe('ride seat count copy (#1412)', () => {
  it('the bare base key does not resolve under v3, so cards must not use it', () => {
    expect(i18n.t('cards.passengers', { count: 3, lng: 'he' })).toBe('cards.passengers');
  });

  it.each([
    ['he', 'passengers', 1, 'נוסע/ת אחד/ת'],
    ['he', 'passengers', 3, '3 נוסעים'],
    ['he', 'seats', 1, 'מקום אחד'],
    ['he', 'seats', 4, '4 מקומות'],
    ['en', 'passengers', 1, '1 passenger'],
    ['en', 'passengers', 2, '2 passengers'],
    ['en', 'seats', 1, '1 seat'],
    ['en', 'seats', 5, '5 seats'],
  ] as const)('%s: %s × %i reads "%s"', (lng, kind, count, expected) => {
    expect(i18n.t(rideSeatCountKey(kind, count), { count, lng })).toBe(expected);
  });

  it('zero takes the plural form', () => {
    expect(rideSeatCountKey('seats', 0)).toBe('cards.seats_other');
  });
});
