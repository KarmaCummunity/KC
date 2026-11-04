// G1 step 4c (ADR-006, D-220) — the share link of a listing. A listing that has a post shares the
// post's link (`/post/<id>`), the one detail screen every other post shares; a listing without a
// post yet (not published) shares its marketplace page. Pure: the caller reads the web base URL.
import type { MarketplaceListingDetail } from '@kc/domain';
import { buildPostShareUrl } from './buildPostShareUrl';

type ListingShareSource = Pick<MarketplaceListingDetail, 'listingId' | 'feedPostId'>;

/** `webBaseUrl` comes from `resolveWebBaseUrl`, so it is already trimmed of trailing slashes. */
export function buildListingShareUrl(listing: ListingShareSource, webBaseUrl: string): string {
  if (listing.feedPostId) return buildPostShareUrl(listing.feedPostId, webBaseUrl);
  return `${webBaseUrl}/donations/marketplace/${encodeURIComponent(listing.listingId)}`;
}
