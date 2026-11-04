import type {
  ExternalBodyOption,
  GivingHandoffSnapshot,
  ListingKindOption,
  WorldSubcategory,
  MarketplaceBrowseRow,
  MarketplaceListingDetail,
  MarketplaceMapCluster,
  MarketplaceMapPin,
  MapBounds,
  MarketplaceSimilarListing,
  MyGivingHandoffRow,
  MyListingRow,
  ProfileListingRow,
} from '@kc/domain';

export interface MarketplaceBrowseFilters {
  worldSlug?: string | null;
  direction?: 'give' | 'request' | null;
  urgencyMin?: number | null;
  availability?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  /** World subcategory (`categories.category_id`, items / food); null = the whole world. KC#1102. */
  categoryId?: string | null;
  limit?: number;
  /** @deprecated use `cursor` (keyset); honoured by the server only without a cursor. */
  offset?: number;
  cursor?: MarketplaceBrowseCursor | null;
}

/** Keyset cursor for browse_listings: (sortKey asc, urgency/createdAt/listingId desc). */
export interface MarketplaceBrowseCursor {
  sortKey: number;
  urgencyLevel: number;
  createdAt: string;
  listingId: string;
}

/** Keyset cursor for marketplace_search: (score desc, listingId desc). */
export interface MarketplaceSearchCursor {
  score: number;
  listingId: string;
}

/** Keyset cursor for list_my_listings: (updatedAt desc, listingId desc). */
export interface MyListingsCursor {
  updatedAt: string;
  listingId: string;
}

export interface MarketplacePage<T, C> {
  rows: T[];
  nextCursor: C | null;
}

export interface IMarketplaceRepository {
  browse(filters: MarketplaceBrowseFilters): Promise<MarketplaceBrowseRow[]>;
  browsePage(
    filters: MarketplaceBrowseFilters,
  ): Promise<MarketplacePage<MarketplaceBrowseRow, MarketplaceBrowseCursor>>;
  search(query: string, worldSlug?: string | null, limit?: number): Promise<string[]>;
  searchPage(
    query: string,
    worldSlug: string | null,
    limit: number,
    cursor?: MarketplaceSearchCursor | null,
  ): Promise<MarketplacePage<string, MarketplaceSearchCursor>>;
  /** One round trip for many cards, in the order of `listingIds`. */
  getListingCards(listingIds: readonly string[]): Promise<MarketplaceBrowseRow[]>;
  recommendForYou(limit?: number): Promise<string[]>;
  mapClusters(bounds: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
    worldSlug?: string | null;
  }): Promise<MarketplaceMapCluster[]>;
  /** Individual approximate pins in a viewport (client clusters them). */
  mapPins(bounds: MapBounds & { worldSlug?: string | null; limit?: number }): Promise<MarketplaceMapPin[]>;
  getListingCard(listingId: string): Promise<MarketplaceBrowseRow | null>;
  getListingDetail(listingId: string): Promise<MarketplaceListingDetail | null>;
  similarListings(listingId: string, limit?: number): Promise<MarketplaceSimilarListing[]>;
  listKindsForWorld(worldSlug: string): Promise<ListingKindOption[]>;
  /** Active subcategories of a giving world, in display order (KC#1296). */
  listWorldSubcategories(worldSlug: string): Promise<WorldSubcategory[]>;
  /** Active + verified organisations for a routed world (search_external_bodies). */
  searchExternalBodies(worldSlug: string, query?: string | null, limit?: number): Promise<ExternalBodyOption[]>;
  createListing(input: {
    kindId: string;
    title: string;
    summary?: string | null;
    details?: Record<string, unknown>;
    direction?: 'give' | 'request' | null;
    cityId?: string | null;
    lat?: number | null;
    lng?: number | null;
    maxRadiusKm?: number | null;
    mediaPaths?: string[];
    /** Required for routed worlds (medical / animals / environment). */
    externalBodyId?: string | null;
    /** The giver's world subcategory; must belong to the listing's world (0462). */
    categoryId?: string | null;
    urgencyLevel?: number;
    availabilityStatus?: string;
  }): Promise<string>;
  recordSignal(listingId: string, signal: 'view' | 'save' | 'response'): Promise<void>;
  shareToFeed(listingId: string): Promise<string>;
  startChat(listingId: string, openingMessage?: string | null): Promise<string>;
  listMyListings(limit?: number, offset?: number): Promise<MyListingRow[]>;
  listMyListingsPage(
    limit: number,
    cursor?: MyListingsCursor | null,
  ): Promise<MarketplacePage<MyListingRow, MyListingsCursor>>;
  listProfileListings(ownerId: string, limit?: number): Promise<ProfileListingRow[]>;
  updateMyListing(
    listingId: string,
    patch: {
      title?: string;
      summary?: string | null;
      details?: Record<string, unknown>;
      cityId?: string | null;
      maxRadiusKm?: number | null;
      urgencyLevel?: number;
      availabilityStatus?: string;
    },
  ): Promise<void>;
  pauseMyListing(listingId: string): Promise<void>;
  resumeMyListing(listingId: string): Promise<void>;
  fulfillMyListing(listingId: string): Promise<void>;
  deleteMyListing(listingId: string): Promise<void>;
  /**
   * Appends already-uploaded photos (storage paths under the owner's folder) to the owner's
   * listing, open, paused or closed; existing photos are never replaced (ten at most).
   * Resolves with the number added. Spec 07 §7.1 "Owner management".
   */
  addMyListingMedia(listingId: string, mediaPaths: readonly string[]): Promise<number>;
  getListingHandoff(listingId: string): Promise<GivingHandoffSnapshot | null>;
  listMyGivingHandoffs(limit?: number): Promise<MyGivingHandoffRow[]>;
  reserveItemGiving(
    listingId: string,
    pickupMode?: 'pickup' | 'delivery',
    pickupWindowStart?: string | null,
    pickupWindowEnd?: string | null,
  ): Promise<GivingHandoffSnapshot>;
  confirmItemHandoff(handoffId: string): Promise<GivingHandoffSnapshot>;
  claimFoodGiving(
    listingId: string,
    pickupWindowStart?: string | null,
    pickupWindowEnd?: string | null,
  ): Promise<GivingHandoffSnapshot>;
  cancelGivingHandoff(handoffId: string): Promise<void>;
  markGivingHandedOver(handoffId: string): Promise<GivingHandoffSnapshot>;
  rateGivingHandoff(handoffId: string, rating: number, comment?: string | null): Promise<void>;
}
