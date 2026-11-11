import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IMarketplaceRepository,
  MarketplaceBrowseFilters,
  MarketplaceSearchCursor,
  MyListingsCursor,
} from '@kc/application';
import type {
  ListingKindOption,
  MarketplaceBrowseRow,
  MarketplaceListingDetail,
  MarketplaceMapCluster,
  MarketplaceMapPin,
  MapBounds,
  MarketplaceSimilarListing,
  MyListingRow,
  ProfileListingRow,
} from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { mapListingDetail } from './mapListingDetail';
import { searchExternalBodies } from './mapExternalBody';
import { listWorldSubcategories } from './listWorldSubcategories';
import * as handoffs from './givingHandoffs';
import * as events from './eventRegistrations';
import * as owner from './listingOwnerActions';
import * as paging from './marketplacePaging';
import { mapPinRow } from './mapPinRow';
import { firstOf, listingDirectionOf, recordPostOf, type CardShapeColumns, type ViewClient } from './listingCardSource';

export class SupabaseMarketplaceRepository implements IMarketplaceRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async browse(filters: MarketplaceBrowseFilters): Promise<MarketplaceBrowseRow[]> {
    return (await paging.fetchBrowsePage(this.client, filters)).rows;
  }

  browsePage(filters: MarketplaceBrowseFilters) {
    return paging.fetchBrowsePage(this.client, filters);
  }

  searchPage(query: string, worldSlug: string | null, limit: number, cursor?: MarketplaceSearchCursor | null) {
    return paging.fetchSearchPage(this.client, query, worldSlug, limit, cursor);
  }

  getListingCards(listingIds: readonly string[]) {
    return paging.fetchListingCards(this.client, listingIds);
  }

  async search(query: string, worldSlug?: string | null, limit = 20): Promise<string[]> {
    const { data, error } = await this.client.rpc('marketplace_search', {
      p_query: query,
      p_world_slug: worldSlug ?? undefined,
      p_limit: limit,
    });
    if (error || !data) return [];
    return data.map((r) => r.listing_id);
  }

  async recommendForYou(limit = 12): Promise<string[]> {
    const { data, error } = await this.client.rpc('recommend_listings_for_user', { p_limit: limit });
    if (error || !data) return [];
    return data.map((r) => r.listing_id);
  }

  async mapClusters(bounds: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
    worldSlug?: string | null;
  }): Promise<MarketplaceMapCluster[]> {
    const { data, error } = await this.client.rpc('map_listing_clusters', {
      p_sw_lat: bounds.swLat,
      p_sw_lng: bounds.swLng,
      p_ne_lat: bounds.neLat,
      p_ne_lng: bounds.neLng,
      p_world_slug: bounds.worldSlug ?? undefined,
    });
    if (error || !data) return [];
    return data.map((c) => ({
      clusterKey: c.cluster_key,
      centerLat: c.center_lat,
      centerLng: c.center_lng,
      listingCount: c.listing_count,
      sampleListingId: c.sample_listing_id,
    }));
  }

  async mapPins(bounds: MapBounds & { worldSlug?: string | null; limit?: number }): Promise<MarketplaceMapPin[]> {
    const { data, error } = await this.client.rpc('map_listing_pins', {
      p_sw_lat: bounds.swLat,
      p_sw_lng: bounds.swLng,
      p_ne_lat: bounds.neLat,
      p_ne_lng: bounds.neLng,
      p_world_slug: bounds.worldSlug ?? undefined,
      p_limit: bounds.limit ?? undefined,
    });
    if (error || !data) return [];
    return data.map(mapPinRow);
  }

  async getListingDetail(listingId: string): Promise<MarketplaceListingDetail | null> {
    const { data, error } = await this.client.rpc('get_marketplace_listing_detail', {
      p_listing_id: listingId,
    });
    if (error || data == null) return null;
    return mapListingDetail(data);
  }

  async similarListings(listingId: string, limit = 6): Promise<MarketplaceSimilarListing[]> {
    const { data, error } = await this.client.rpc('similar_listings', {
      p_listing_id: listingId,
      p_limit: limit,
    });
    if (error || !data) return [];
    return data.map((r) => ({
      listingId: r.listing_id,
      title: r.title,
      worldSlug: r.world_slug,
      kindSlug: r.kind_slug,
    }));
  }

  async listKindsForWorld(worldSlug: string): Promise<ListingKindOption[]> {
    const { data, error } = await this.client
      .from('listing_kinds')
      .select('kind_id, slug, label_en, label_he, direction, detail_schema')
      .eq('world_slug', worldSlug)
      .eq('is_active', true)
      .order('sort_order');
    if (error || !data) return [];
    return data.map((k) => ({
      kindId: k.kind_id,
      slug: k.slug,
      labelEn: k.label_en,
      labelHe: k.label_he,
      direction: k.direction as ListingKindOption['direction'],
      detailSchema: (k.detail_schema as Record<string, unknown>) ?? {},
    }));
  }

  searchExternalBodies = (worldSlug: string, query?: string | null, limit?: number) =>
    searchExternalBodies(this.client, worldSlug, query, limit);

  listWorldSubcategories = (worldSlug: string) => listWorldSubcategories(this.client, worldSlug);

  async getListingCard(listingId: string): Promise<MarketplaceBrowseRow | null> {
    const { data, error } = await (this.client as unknown as ViewClient)
      .from('listings')
      .select('listing_id, world_slug, direction, title, summary, urgency_level, availability_status, city_id, kind_id, origin, legacy_post_id')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as typeof data & CardShapeColumns;
    // A post-owned listing reads its post, the record; title, summary and city stay the listing's.
    const post = recordPostOf(row);
    if (post) {
      return {
        listingId: row.listing_id ?? '',
        worldSlug: post.world_slug,
        kindSlug: firstOf(post.kind)?.slug ?? '',
        direction: listingDirectionOf(post.direction),
        title: row.title ?? '',
        summary: row.summary,
        urgencyLevel: (post.urgency_level ?? row.urgency_level) ?? 2,
        availabilityStatus: post.availability_status,
        cityId: row.city_id,
        distanceKm: null,
      };
    }
    const { data: kindRow } = await this.client
      .from('listing_kinds')
      .select('slug')
      .eq('kind_id', row.kind_id ?? '')
      .maybeSingle();
    return {
      listingId: row.listing_id ?? '',
      worldSlug: row.world_slug ?? '',
      kindSlug: kindRow?.slug ?? '',
      direction: row.direction as 'give' | 'request',
      title: row.title ?? '',
      summary: row.summary,
      urgencyLevel: row.urgency_level ?? 2,
      availabilityStatus: row.availability_status ?? 'ongoing',
      cityId: row.city_id,
      distanceKm: null,
    };
  }

  async createListing(
    input: Parameters<IMarketplaceRepository['createListing']>[0],
  ): Promise<string> {
    const { data, error } = await this.client.rpc('create_marketplace_listing', {
      p_kind_id: input.kindId,
      p_title: input.title,
      p_summary: input.summary ?? undefined,
      p_details: (input.details ?? {}) as Database['public']['Functions']['create_marketplace_listing']['Args']['p_details'],
      p_direction: input.direction ?? undefined,
      p_city_id: input.cityId ?? undefined,
      p_lat: input.lat ?? undefined,
      p_lng: input.lng ?? undefined,
      p_max_radius_km: input.maxRadiusKm ?? undefined,
      p_media_paths: input.mediaPaths ?? undefined,
      p_external_body_id: input.externalBodyId ?? undefined,
      p_category_id: input.categoryId ?? undefined,
      p_urgency_level: input.urgencyLevel ?? undefined,
      p_availability_status: input.availabilityStatus ?? undefined,
      p_additional_world_slugs: input.additionalWorldSlugs ?? undefined,
    });
    if (error || !data) throw error ?? new Error('create_marketplace_listing failed');
    return data as string;
  }

  async recordSignal(listingId: string, signal: 'view' | 'save' | 'response'): Promise<void> {
    await this.client.rpc('record_listing_signal', {
      p_listing_id: listingId,
      p_signal_type: signal,
    });
  }

  async shareToFeed(listingId: string): Promise<string> {
    const { data, error } = await this.client.rpc('share_listing_to_feed', { p_listing_id: listingId });
    if (error || !data) throw error ?? new Error('share_listing_to_feed failed');
    return data as string;
  }

  async startChat(listingId: string, openingMessage?: string | null): Promise<string> {
    const { data, error } = await this.client.rpc('start_listing_chat', {
      p_listing_id: listingId,
      p_opening_message: openingMessage ?? undefined,
    });
    if (error || !data) throw error ?? new Error('start_listing_chat failed');
    return data as string;
  }

  async listMyListings(limit = 50, offset = 0): Promise<MyListingRow[]> {
    return (await paging.fetchMyListingsPage(this.client, limit, null, offset)).rows;
  }

  listMyListingsPage(limit: number, cursor?: MyListingsCursor | null) {
    return paging.fetchMyListingsPage(this.client, limit, cursor);
  }

  async listProfileListings(ownerId: string, limit = 24): Promise<ProfileListingRow[]> {
    const { data, error } = await this.client.rpc('list_profile_listings', {
      p_owner_id: ownerId,
      p_limit: limit,
    });
    if (error || !data) return [];
    return data.map((r) => ({
      listingId: r.listing_id,
      worldSlug: r.world_slug,
      kindSlug: r.kind_slug,
      direction: r.direction as 'give' | 'request',
      status: r.status,
      title: r.title,
      summary: r.summary,
    }));
  }

  // Owner lifecycle (spec 07 §7.1 "Owner management") — see listingOwnerActions.ts.
  updateMyListing = (listingId: string, patch: Parameters<IMarketplaceRepository['updateMyListing']>[1]) =>
    owner.updateMyListing(this.client, listingId, patch);
  pauseMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'pause_my_listing', listingId);
  resumeMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'resume_my_listing', listingId);
  fulfillMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'fulfill_my_listing', listingId);
  deleteMyListing = (listingId: string) => owner.runOwnerAction(this.client, 'delete_my_listing', listingId);
  addMyListingMedia = (listingId: string, mediaPaths: readonly string[]) =>
    owner.addMyListingMedia(this.client, listingId, mediaPaths);

  // Items/food handoffs — see givingHandoffs.ts.
  getListingHandoff = (listingId: string) => handoffs.getListingHandoff(this.client, listingId);
  listMyGivingHandoffs = (limit?: number) => handoffs.listMyGivingHandoffs(this.client, limit);
  reserveItemGiving = (
    listingId: string,
    pickupMode?: 'pickup' | 'delivery',
    start?: string | null,
    end?: string | null,
  ) => handoffs.reserveItemGiving(this.client, listingId, pickupMode, start, end);
  confirmItemHandoff = (id: string) => handoffs.confirmItemHandoff(this.client, id);
  claimFoodGiving = (listingId: string, start?: string | null, end?: string | null) =>
    handoffs.claimFoodGiving(this.client, listingId, start, end);
  cancelGivingHandoff = (id: string) => handoffs.cancelGivingHandoff(this.client, id);
  markGivingHandedOver = (id: string) => handoffs.markGivingHandedOver(this.client, id);
  rateGivingHandoff = (id: string, rating: number, comment?: string | null) =>
    handoffs.rateGivingHandoff(this.client, id, rating, comment);

  // Organization events (G1 step 5) — see eventRegistrations.ts.
  registerForEvent = (target: string) => events.registerForEvent(this.client, target);
  decideEventRegistration = (id: string, approve: boolean) => events.decideEventRegistration(this.client, id, approve);
  cancelEventRegistration = (id: string) => events.cancelEventRegistration(this.client, id);
  markEventAttendance = (id: string, attended: boolean) => events.markEventAttendance(this.client, id, attended);
  listEventRegistrations = (target: string) => events.listEventRegistrations(this.client, target);
  getMyEventRegistration = (postId: string) => events.getMyEventRegistration(this.client, postId);
  listMyOrganizations = () => events.listMyOrganizations(this.client);
}
