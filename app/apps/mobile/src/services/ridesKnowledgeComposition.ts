import { getMarketplaceSupabaseClient } from './marketplaceComposition';

export interface RideMatchRow {
  listing_id: string;
  title: string;
  direction: string;
  seats_left: number;
  departs_at: string;
  origin_label: string | null;
  dest_label: string | null;
  distance_m: number;
}

export const ridesKnowledgeRpcs = {
  async findMatches(input: {
    originLat: number; originLng: number;
    destLat: number; destLng: number;
    radiusKm?: number;
  }): Promise<RideMatchRow[]> {
    const { data, error } = await getMarketplaceSupabaseClient().rpc('find_ride_listing_matches', {
      p_origin_lat: input.originLat,
      p_origin_lng: input.originLng,
      p_dest_lat: input.destLat,
      p_dest_lng: input.destLng,
      p_radius_km: input.radiusKm ?? 15,
    });
    if (error) throw error;
    return (data ?? []);
  },
  async bookKnowledgeSlot(listingId: string) {
    const { data, error } = await getMarketplaceSupabaseClient().rpc('book_knowledge_slot', {
      p_listing_id: listingId,
    });
    if (error) throw error;
    return data;
  },
  async completeKnowledgeSession(handoffId: string) {
    const { data, error } = await getMarketplaceSupabaseClient().rpc('complete_knowledge_session', {
      p_handoff_id: handoffId,
    });
    if (error) throw error;
    return data;
  },
};
