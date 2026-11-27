import { describe, it, expect } from 'vitest';
import { rideSeatCountKey } from '../rideSeatCountKey';

describe('rideSeatCountKey', () => {
  it('returns the cards.seats base key for offers', () => {
    expect(rideSeatCountKey('seats')).toBe('cards.seats');
  });

  it('returns the cards.passengers base key for requests', () => {
    expect(rideSeatCountKey('passengers')).toBe('cards.passengers');
  });
});
