/** World-specific owner close copy (FR-CLOSURE-011). */

const CLOSE_WITHOUT_WORLDS = new Set(['items', 'animals']);

/** i18n key for the owner's primary close action on an open give offer. */
export function listingOwnerMarkCtaKey(worldSlug: string | null): string {
  if (worldSlug === 'animals') return 'closure.markAnimalsCta';
  if (worldSlug === 'housing') return 'closure.markHousingCta';
  if (worldSlug === 'rides') return 'closure.markRidesCta';
  return 'closure.markGiveCta';
}

/** Items and animals may close with nobody named. Rides and housing name one person. */
export function listingOfferAllowsCloseWithout(worldSlug: string | null): boolean {
  return worldSlug !== null && CLOSE_WITHOUT_WORLDS.has(worldSlug);
}
