import { describe, it, expect } from 'vitest';
import type { LocationDisplayLevel } from '@kc/domain';
import { postLocationText } from '../postLocationText';

const post = (level: LocationDisplayLevel, street = 'Herzl', streetNumber = '12') => ({
  locationDisplayLevel: level,
  address: { cityName: 'Haifa', street, streetNumber },
});

describe('postLocationText (FR-POST-019 AC5)', () => {
  it('follows the display level the poster chose', () => {
    expect(postLocationText(post('CityOnly'))).toBe('Haifa');
    expect(postLocationText(post('CityAndStreet'))).toBe('Haifa, Herzl');
    expect(postLocationText(post('FullAddress'))).toBe('Haifa, Herzl 12');
  });

  it('writes the street prefix only before a street shown without its number', () => {
    expect(postLocationText(post('CityAndStreet'), 'St.')).toBe('Haifa, St. Herzl');
    expect(postLocationText(post('FullAddress'), 'St.')).toBe('Haifa, Herzl 12');
  });

  it('falls back to the city when no street was released, never a dangling comma', () => {
    expect(postLocationText(post('CityAndStreet', ''))).toBe('Haifa');
    expect(postLocationText(post('FullAddress', '  ', ''))).toBe('Haifa');
    expect(postLocationText(post('FullAddress', 'Herzl', ''))).toBe('Haifa, Herzl');
  });
});
