// KC#2288 — an event's place line comes from the structured address, never from older free text.
import { describe, expect, it, vi } from 'vitest';

// The module also shapes ride details; its ride import pulls native modules the test does not need.
vi.mock('../../../components/giving/RideCreateSection', () => ({ RIDE_CREATE_DETAIL_KEYS: [] }));

import { withEventAddress } from '../listingCreateDetails';

describe('withEventAddress', () => {
  it('leaves the details of a kind without a street address untouched', () => {
    const details = { duration_minutes: 60, address: 'kept as it is' };
    expect(withEventAddress(details, null)).toBe(details);
  });

  it('sets the place line of an event', () => {
    expect(withEventAddress({ capacity: 30 }, 'הרצל 12')).toEqual({ capacity: 30, address: 'הרצל 12' });
  });

  it('replaces an older free-text address on an edit', () => {
    expect(withEventAddress({ address: 'ליד הים' }, 'הרצל 12')).toEqual({ address: 'הרצל 12' });
  });

  it('drops the line when the address is empty, so an empty text is never sent', () => {
    expect(withEventAddress({ capacity: 30, address: 'ליד הים' }, '')).toEqual({ capacity: 30 });
  });
});
