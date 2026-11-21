/** World-specific owner close copy (FR-CLOSURE-011). */

import { worldOwnerMarkCtaKey } from './worldDetailCopy';

const CLOSE_WITHOUT_WORLDS = new Set(['items', 'animals']);

/** i18n key for the owner's primary close action on an open give offer (see worldDetailCopy). */
export function listingOwnerMarkCtaKey(worldSlug: string | null): string {
  return worldOwnerMarkCtaKey(worldSlug, 'Give');
}

/**
 * Closure options for a post that may belong to a listing world. A listing closes through the
 * owner-assign RPC; the generic closure RPC refuses worlds with their own flow, e.g. rides (#2360).
 */
export function listingClosureOptions(worldSlug: string | null): { offerAssign?: true; allowCloseWithout?: boolean } {
  if (worldSlug === null) return {};
  return { offerAssign: true, allowCloseWithout: listingOfferAllowsCloseWithout(worldSlug) };
}

/** Items and animals may close with nobody named. Rides and housing name one person. */
export function listingOfferAllowsCloseWithout(worldSlug: string | null): boolean {
  return worldSlug !== null && CLOSE_WITHOUT_WORLDS.has(worldSlug);
}
