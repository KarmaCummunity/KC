import { describe, expect, it } from 'vitest';
import { listingClosureOptions, listingOfferAllowsCloseWithout, listingOwnerMarkCtaKey } from '../listingOwnerClosure';

describe('listingOwnerClosure', () => {
  it('uses the world label for animals, housing and rides', () => {
    expect(listingOwnerMarkCtaKey('animals')).toBe('closure.markAnimalsCta');
    expect(listingOwnerMarkCtaKey('housing')).toBe('closure.markHousingCta');
    expect(listingOwnerMarkCtaKey('rides')).toBe('closure.markRidesCta');
    expect(listingOwnerMarkCtaKey('food')).toBe('closure.markGiveCta');
  });

  it('words the volunteering close as taking place, and keeps "delivered" for items (#2078)', () => {
    expect(listingOwnerMarkCtaKey('time')).toBe('closure.markTimeCta');
    expect(listingOwnerMarkCtaKey('items')).toBe('closure.markGiveCta');
  });

  it('allows close-without only for items and animals', () => {
    expect(listingOfferAllowsCloseWithout('items')).toBe(true);
    expect(listingOfferAllowsCloseWithout('animals')).toBe(true);
    expect(listingOfferAllowsCloseWithout('rides')).toBe(false);
    expect(listingOfferAllowsCloseWithout('housing')).toBe(false);
    expect(listingOfferAllowsCloseWithout(null)).toBe(false);
  });
});

describe("listingClosureOptions (#2360)", () => {
  it("routes a ride through the owner-assign flow, naming one person", () => {
    expect(listingClosureOptions("rides")).toEqual({ offerAssign: true, allowCloseWithout: false });
  });
  it("lets an items listing close with nobody named", () => {
    expect(listingClosureOptions("items")).toEqual({ offerAssign: true, allowCloseWithout: true });
  });
  it("leaves a social post on the generic closure", () => {
    expect(listingClosureOptions(null)).toEqual({});
  });
});
