import { describe, expect, it } from 'vitest';
import { listingOfferAllowsCloseWithout, listingOwnerMarkCtaKey } from '../listingOwnerClosure';

describe('listingOwnerClosure', () => {
  it('uses the world label for animals, housing and rides', () => {
    expect(listingOwnerMarkCtaKey('animals')).toBe('closure.markAnimalsCta');
    expect(listingOwnerMarkCtaKey('housing')).toBe('closure.markHousingCta');
    expect(listingOwnerMarkCtaKey('rides')).toBe('closure.markRidesCta');
    expect(listingOwnerMarkCtaKey('food')).toBe('closure.markGiveCta');
  });

  it('allows close-without only for items and animals', () => {
    expect(listingOfferAllowsCloseWithout('items')).toBe(true);
    expect(listingOfferAllowsCloseWithout('animals')).toBe(true);
    expect(listingOfferAllowsCloseWithout('rides')).toBe(false);
    expect(listingOfferAllowsCloseWithout('housing')).toBe(false);
    expect(listingOfferAllowsCloseWithout(null)).toBe(false);
  });
});
