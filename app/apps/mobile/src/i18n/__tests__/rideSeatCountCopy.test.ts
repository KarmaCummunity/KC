// #1412 / #1784: ride cards must resolve seat/passenger plurals via JSON v4 (no compatibilityJSON v3).
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '../index';
import { rideSeatCountKey } from '../../lib/rideSeatCountKey';

const originalLanguage = i18n.language;
afterAll(() => i18n.changeLanguage(originalLanguage));

describe('ride seat count copy (#1412 / #1784 JSON v4 plurals)', () => {
  it.each([
    ['he', 'passengers', 1, 'נוסע/ת אחד/ת'],
    ['he', 'passengers', 2, 'שני נוסעים'],
    ['he', 'passengers', 3, '3 נוסעים'],
    ['he', 'seats', 1, 'מקום אחד'],
    ['he', 'seats', 2, 'שני מקומות'],
    ['he', 'seats', 4, '4 מקומות'],
    ['en', 'passengers', 1, '1 passenger'],
    ['en', 'passengers', 2, '2 passengers'],
    ['en', 'seats', 1, '1 seat'],
    ['en', 'seats', 5, '5 seats'],
  ] as const)('%s: %s × %i reads "%s"', (lng, kind, count, expected) => {
    expect(i18n.t(rideSeatCountKey(kind), { count, lng })).toBe(expected);
  });

  it('zero takes the other form in both locales', () => {
    expect(i18n.t('cards.seats', { count: 0, lng: 'he' })).toBe('0 מקומות');
    expect(i18n.t('cards.seats', { count: 0, lng: 'en' })).toBe('0 seats');
  });
});
