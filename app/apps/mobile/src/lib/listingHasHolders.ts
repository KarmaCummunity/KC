// FR-RIDE-047, D131 — listings whose bookings or registrations the owner may call off: pausing
// or deleting one cancels each seat or registration and tells its holder, so the owner confirms
// first and is told who will hear of it. Other listings keep their own rules (an item's
// reservation blocks a pause or a delete until it is settled).
import type { MyListingRow } from '@kc/domain';
import { ORG_EVENT_KIND_SLUG } from '@kc/domain';

/** True when pausing or deleting this listing cancels the bookings or registrations it holds. */
export function ownerCancelNotifiesHolders(listing: Pick<MyListingRow, 'worldSlug' | 'kindSlug'>): boolean {
  return listing.worldSlug === 'rides' || listing.kindSlug === ORG_EVENT_KIND_SLUG;
}
