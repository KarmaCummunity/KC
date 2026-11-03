import { describe, it, expect } from 'vitest';
import { rideSeatCountKey } from '../rideSeatCountKey';

describe('rideSeatCountKey', () => {
  it('resolves singular _one suffix when count is 1 for seats', () => {
    expect(rideSeatCountKey('seats', 1)).toBe('cards.seats_one');
  });

  it('resolves plural _other suffix when count is greater than 1 for seats', () => {
    expect(rideSeatCountKey('seats', 2)).toBe('cards.seats_other');
    expect(rideSeatCountKey('seats', 4)).toBe('cards.seats_other');
  });

  it('resolves plural _other suffix when count is 0 for seats', () => {
    expect(rideSeatCountKey('seats', 0)).toBe('cards.seats_other');
  });

  it('resolves singular _one suffix when count is 1 for passengers', () => {
    expect(rideSeatCountKey('passengers', 1)).toBe('cards.passengers_one');
  });

  it('resolves plural _other suffix when count is greater than 1 for passengers', () => {
    expect(rideSeatCountKey('passengers', 3)).toBe('cards.passengers_other');
  });
});
