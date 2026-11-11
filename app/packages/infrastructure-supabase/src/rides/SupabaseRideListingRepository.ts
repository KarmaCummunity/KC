import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreateRideListingRepoInput,
  FindRideMatchesInput,
  IRideListingRepository,
  ListMyRidesInput,
  RideListingRow,
  RideVisibility,
  SearchRideListingsInput,
} from '@kc/application';
import { RideError } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { mapRideRow } from './mapRideRow';

type RideRow = Parameters<typeof mapRideRow>[0];
type ViewClient = { from: (table: string) => ReturnType<SupabaseClient['from']> };

const RIDE_SELECT =
  '*, origin_city:cities!ride_listings_origin_city_id_fkey(name_he), dest_city:cities!ride_listings_dest_city_id_fkey(name_he)';

type RideRowWithCities = RideRow & {
  origin_city: { name_he: string } | null;
  dest_city: { name_he: string } | null;
};

function mapJoinedRow(row: RideRowWithCities): RideListingRow {
  return mapRideRow(
    row,
    row.origin_city?.name_he ?? '',
    row.dest_city?.name_he ?? '',
  );
}

export class SupabaseRideListingRepository implements IRideListingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async create(input: CreateRideListingRepoInput): Promise<RideListingRow> {
    const { data, error } = await (this.client as unknown as ViewClient)
      .from('ride_listings')
      .insert({
        owner_id: input.ownerId,
        mode: input.mode,
        origin_city_id: input.originCityId,
        dest_city_id: input.destCityId,
        origin_street: input.originStreet,
        origin_street_number: input.originStreetNumber,
        dest_street: input.destStreet,
        dest_street_number: input.destStreetNumber,
        departs_at: input.departsAt,
        seats_available: input.seatsAvailable,
        description: input.description,
        title: input.title,
        visibility: input.visibility,
        // FR-RIDE-026..029 — advanced fields, NULL-or-set per the CHECK constraints.
        cargo_enabled: input.cargoEnabled ?? false,
        cargo_max_volume_l: input.cargoEnabled ? input.cargoMaxVolumeL ?? null : null,
        cargo_max_weight_kg: input.cargoEnabled ? input.cargoMaxWeightKg ?? null : null,
        cargo_allowed_types: input.cargoEnabled
          ? (input.cargoAllowedTypes ? Array.from(input.cargoAllowedTypes) : null)
          : null,
        food_shipping_enabled: input.foodShippingEnabled ?? false,
        food_max_kg: input.foodShippingEnabled ? input.foodMaxKg ?? null : null,
        food_chilled: input.foodShippingEnabled ? input.foodChilled ?? null : null,
        payment_model: input.paymentModel ?? 'free',
        payment_amount_ils:
          input.paymentModel === 'expense_share' ? input.paymentAmountIls ?? null : null,
        req_gender: input.reqGender ?? 'any',
        req_smoking_allowed: input.reqSmokingAllowed ?? false,
        req_pets_allowed: input.reqPetsAllowed ?? false,
        req_verified_only: input.reqVerifiedOnly ?? false,
        linked_post_id: input.linkedPostId ?? null,
      })
      .select(RIDE_SELECT)
      .single();
    if (error) {
      // Map DB constraint violations to typed RideError codes.
      const msg = (error.message ?? '').toLowerCase();
      if (msg.includes('payment_cap_exceeded')) {
        throw new RideError('payment_cap_exceeded', 'payment cap exceeded');
      }
      if (msg.includes('ride_listings_cargo_consistency')) {
        throw new RideError('cargo_invalid_bounds', error.message);
      }
      if (msg.includes('ride_listings_food_consistency')) {
        throw new RideError('food_invalid_bounds', error.message);
      }
      if (msg.includes('ride_listings_cargo_xor_food')) {
        throw new RideError('cargo_food_mutually_exclusive', error.message);
      }
      if (msg.includes('ride_listings_payment_consistency')) {
        throw new RideError('payment_amount_required', error.message);
      }
      if (msg.includes('declaration_required')) {
        throw new RideError('declaration_required', error.message);
      }
      throw new Error(error.message);
    }
    return mapJoinedRow(data as RideRowWithCities);
  }

  async getById(rideId: string, _viewerId: string): Promise<RideListingRow | null> {
    const { data, error } = await (this.client as unknown as ViewClient)
      .from('ride_listings')
      .select(RIDE_SELECT)
      .eq('ride_id', rideId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapJoinedRow(data as RideRowWithCities);
  }

  async search(input: SearchRideListingsInput): Promise<RideListingRow[]> {
    const { data, error } = await this.client.rpc('ride_listings_search', {
      p_query: input.query ?? undefined,
      p_origin_city_id: input.originCityId ?? undefined,
      p_dest_city_id: input.destCityId ?? undefined,
      p_mode: input.mode ?? undefined,
      p_depart_from: input.departFrom ?? undefined,
      p_depart_to: input.departTo ?? undefined,
      p_limit: input.limit ?? 30,
      p_cursor: input.cursor ?? undefined,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RideRow[];
    if (rows.length === 0) return [];

    const cityIds = [...new Set(rows.flatMap((r) => [r.origin_city_id, r.dest_city_id]))];
    const { data: cities, error: cityErr } = await this.client
      .from('cities')
      .select('city_id, name_he')
      .in('city_id', cityIds);
    if (cityErr) throw new Error(cityErr.message);
    const nameById = new Map((cities ?? []).map((c) => [c.city_id, c.name_he]));

    return rows.map((r) =>
      mapRideRow(
        r,
        nameById.get(r.origin_city_id) ?? '',
        nameById.get(r.dest_city_id) ?? '',
      ),
    );
  }

  async close(rideId: string, ownerId: string, status: 'closed' | 'cancelled'): Promise<void> {
    const { error } = await (this.client as unknown as ViewClient)
      .from('ride_listings')
      .update({ status })
      .eq('ride_id', rideId)
      .eq('owner_id', ownerId);
    if (error) throw new Error(error.message);
  }

  async updateVisibility(input: {
    rideId: string;
    visibility: RideVisibility;
  }): Promise<RideListingRow> {
    const { data, error } = await this.client.rpc('rpc_ride_update_visibility', {
      p_ride_id: input.rideId,
      p_visibility: input.visibility,
    });
    if (error) {
      const code = (error.message ?? '').trim();
      switch (code) {
        case 'auth_required':
        case 'invalid_visibility':
        case 'ride_not_found':
        case 'not_ride_owner':
        case 'ride_not_open':
          throw new RideError(code, code);
        default:
          throw new Error(error.message);
      }
    }
    // The RPC returns the updated row, but without the joined city names.
    // Fall back to a SELECT to get the camelCase shape with names attached.
    const row = data as { ride_id: string } | null;
    if (!row?.ride_id) throw new Error('updateVisibility: empty response');
    const fetched = await this.getById(row.ride_id, ''); // viewerId unused in adapter
    if (!fetched) throw new Error('updateVisibility: row not visible after update');
    return fetched;
  }

  async listMyRides(input: ListMyRidesInput): Promise<RideListingRow[]> {
    const statuses = input.statuses ?? (['open', 'closed', 'cancelled', 'expired'] as const);
    const limit = Math.min(input.limit ?? 50, 200);
    // FR-RIDE-024 AC2 — bound the past window so a long-tenured user doesn't
    // pull their entire history. Default 30 days; callers can pass `null` to
    // disable. RLS already restricts to rides where owner_id = auth.uid().
    const since =
      input.since === null
        ? null
        : (input.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    let query = (this.client as unknown as ViewClient)
      .from('ride_listings')
      .select(RIDE_SELECT)
      .eq('owner_id', input.ownerId)
      .in('status', statuses as readonly string[])
      .order('departs_at', { ascending: false })
      .limit(limit);
    if (since !== null) query = query.gte('departs_at', since);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as RideRowWithCities[]).map(mapJoinedRow);
  }

  async start(rideId: string): Promise<RideListingRow> {
    const { error } = await this.client.rpc('rpc_ride_start', { p_ride_id: rideId });
    if (error) {
      const code = (error.message ?? '').trim();
      switch (code) {
        case 'auth_required':
        case 'ride_not_found':
        case 'not_ride_owner':
        case 'invalid_status_transition':
        case 'start_window_not_open':
          throw new RideError(code, code);
        default:
          throw new Error(error.message);
      }
    }
    // The RPC returns the updated row without city joins; refetch via getById
    // so the consumer gets the camelCase shape with names.
    const fetched = await this.getById(rideId, '');
    if (!fetched) throw new Error('start: row not visible after update');
    return fetched;
  }

  async arrive(rideId: string, reason: 'arrived' | 'breakdown'): Promise<RideListingRow> {
    const { error } = await this.client.rpc('rpc_ride_arrive', {
      p_ride_id: rideId,
      p_reason: reason,
    });
    if (error) {
      const code = (error.message ?? '').trim();
      switch (code) {
        case 'auth_required':
        case 'ride_not_found':
        case 'not_ride_owner':
        case 'ride_not_in_transit':
        case 'invalid_status_transition':
          throw new RideError(code, code);
        default:
          throw new Error(error.message);
      }
    }
    const fetched = await this.getById(rideId, '');
    if (!fetched) throw new Error('arrive: row not visible after update');
    return fetched;
  }

  async findMatches(input: FindRideMatchesInput): Promise<RideListingRow[]> {
    const { data, error } = await this.client.rpc('ride_listings_find_matches', {
      p_ride_id: input.rideId,
      p_window_hours: input.windowHours ?? undefined,
      p_limit: input.limit ?? undefined,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RideRow[];
    if (rows.length === 0) return [];

    const cityIds = [...new Set(rows.flatMap((r) => [r.origin_city_id, r.dest_city_id]))];
    const { data: cities, error: cityErr } = await this.client
      .from('cities')
      .select('city_id, name_he')
      .in('city_id', cityIds);
    if (cityErr) throw new Error(cityErr.message);
    const nameById = new Map((cities ?? []).map((c) => [c.city_id, c.name_he]));

    return rows.map((r) =>
      mapRideRow(
        r,
        nameById.get(r.origin_city_id) ?? '',
        nameById.get(r.dest_city_id) ?? '',
      ),
    );
  }
}
