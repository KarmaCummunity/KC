// Which listings carry a flow of their own on the detail screen — the generic handoff (items,
// food, knowledge), ride bookings or housing stays (FR-HOUSING-015) — and so which viewer gets a flow action there. The flow
// action is the screen's one primary call to action (spec 17 §8.1 call 6).
import type { MarketplaceListingDetail } from '@kc/domain';

/** Worlds whose "give" listings run the generic handoff (reserve, claim, book a slot). */
export const HANDOFF_WORLDS: readonly string[] = ['items', 'food', 'knowledge'];

/** Worlds whose "give" listings carry a flow on the detail screen: the handoff worlds, rides and housing stays. */
const FLOW_WORLDS: readonly string[] = [...HANDOFF_WORLDS, 'rides', 'housing'];

type FlowListing = Pick<MarketplaceListingDetail, 'direction' | 'worldSlug' | 'ownerId'>;

/**
 * Whether the listing's flow offers this viewer an action on the detail screen: a signed-in
 * viewer who is not the owner, on a "give" listing in a flow world. A guest sees no flow section,
 * the owner's section has its own actions (approve, confirm) and a request listing has no flow,
 * so there "message the owner" is the primary instead.
 */
export function listingFlowHasViewerAction(listing: FlowListing, viewerId: string | null): boolean {
  if (viewerId === null || viewerId === listing.ownerId) return false;
  return listing.direction === 'give' && FLOW_WORLDS.includes(listing.worldSlug);
}
