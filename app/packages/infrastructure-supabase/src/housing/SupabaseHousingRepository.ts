import type { SupabaseClient } from '@supabase/supabase-js';
import type { HousingGuestStay, HousingHostBooking, HousingPrivateDetails, HousingStayRequestInput } from '@kc/domain';
import type { HousingPrivateDetailsInput, IHousingRepository } from '@kc/application';
import type { Database } from '../database.types';
import { mapGuestStayRow, mapHostBookingRow, mapPrivateDetailsRow } from './housingMappers';

type Client = SupabaseClient<Database>;

/** The server's answer when the exact place is not open to the caller (0601). */
const PRIVATE_DETAILS_HIDDEN = 'housing_private_details_hidden';

/** Optional RPC text argument: the generated types take `undefined`, never `null`. */
const opt = (value: string | null | undefined): string | undefined => value ?? undefined;
const optNum = (value: number | null | undefined): number | undefined => value ?? undefined;

/**
 * Housing stays over the 0600–0603 RPCs (docs/spec/requirements/21_housing.md FR-HOUSING-003, 012,
 * 015–022). Server errors keep their message (an error code such as `housing_pending_cap`) so
 * the UI can map it to copy; the server pushes every booking change to the other side.
 */
export class SupabaseHousingRepository implements IHousingRepository {
  constructor(private readonly client: Client) {}

  async currentConductVersion(): Promise<number> {
    const { data, error } = await this.client.rpc('housing_conduct_version');
    if (error) throw new Error(error.message);
    return data;
  }

  /** RLS returns only the caller's own acceptance rows. */
  async hasAcceptedConduct(): Promise<boolean> {
    const version = await this.currentConductVersion();
    const { count, error } = await this.client
      .from('housing_conduct_acceptances')
      .select('version', { count: 'exact', head: true })
      .eq('version', version);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async acceptConduct(version: number): Promise<void> {
    const { error } = await this.client.rpc('accept_housing_conduct', { p_version: version });
    if (error) throw new Error(error.message);
  }

  async requestStay(input: HousingStayRequestInput): Promise<string> {
    const { data, error } = await this.client.rpc('request_housing_booking', {
      p_listing_id: input.listingId,
      p_check_in: input.checkInDate,
      p_check_out: input.checkOutDate,
      p_adults: input.adults,
      p_minors: input.minors,
      p_message: input.message,
      p_minors_guardian_ack: input.minorsGuardianAck,
    });
    if (error) throw new Error(error.message);
    return data.handoff_id;
  }

  async decide(handoffId: string, approve: boolean, note: string | null): Promise<void> {
    const { error } = await this.client.rpc('decide_housing_booking', {
      p_handoff_id: handoffId, p_approve: approve, p_note: opt(note),
    });
    if (error) throw new Error(error.message);
  }

  async cancel(handoffId: string, note: string | null): Promise<void> {
    const { error } = await this.client.rpc('cancel_housing_booking', { p_handoff_id: handoffId, p_note: opt(note) });
    if (error) throw new Error(error.message);
  }

  async complete(handoffId: string): Promise<void> {
    const { error } = await this.client.rpc('complete_housing_booking', { p_handoff_id: handoffId });
    if (error) throw new Error(error.message);
  }

  async markNoShow(handoffId: string): Promise<void> {
    const { error } = await this.client.rpc('mark_housing_no_show', { p_handoff_id: handoffId });
    if (error) throw new Error(error.message);
  }

  async listForOffer(listingId: string): Promise<HousingHostBooking[]> {
    const { data, error } = await this.client.rpc('list_housing_bookings', { p_listing_id: listingId });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) => {
      const booking = mapHostBookingRow(row);
      return booking ? [booking] : [];
    });
  }

  async listMyStays(limit?: number): Promise<HousingGuestStay[]> {
    const { data, error } = await this.client.rpc('list_my_housing_stays', { p_limit: limit });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) => {
      const stay = mapGuestStayRow(row);
      return stay ? [stay] : [];
    });
  }

  /** Null instead of an error when the place is simply not open to the caller. */
  async getPrivateDetails(listingId: string): Promise<HousingPrivateDetails | null> {
    const { data, error } = await this.client.rpc('get_housing_private_details', { p_listing_id: listingId });
    if (error) {
      if (error.message === PRIVATE_DETAILS_HIDDEN) return null;
      throw new Error(error.message);
    }
    const row = data?.[0];
    return row ? mapPrivateDetailsRow(row) : null;
  }

  async setPrivateDetails(input: HousingPrivateDetailsInput): Promise<void> {
    const { error } = await this.client.rpc('set_housing_private_details', {
      p_listing_id: input.listingId,
      p_street_id: input.streetId,
      p_house_number: input.houseNumber,
      p_apartment: opt(input.apartment),
      p_floor: opt(input.floor),
      p_entrance_notes: opt(input.entranceNotes),
      p_access_instructions: opt(input.accessInstructions),
      p_lat: optNum(input.lat),
      p_lng: optNum(input.lng),
    });
    if (error) throw new Error(error.message);
  }
}
