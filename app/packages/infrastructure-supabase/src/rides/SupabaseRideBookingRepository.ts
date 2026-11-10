import type { SupabaseClient } from '@supabase/supabase-js';
import { isRideBookingListStatus, type RideBooking } from '@kc/domain';
import type { IRideBookingRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type BookingRow = Database['public']['Functions']['list_ride_bookings']['Returns'][number];
type HandoffRpc =
  | 'confirm_ride_booking'
  | 'decline_ride_booking'
  | 'cancel_ride_booking'
  | 'complete_ride_trip'
  | 'reinstate_ride_booking';

/**
 * Ride seat bookings over the 0393/0453/0511 RPCs (docs/spec/05_giving_worlds.md §5.3, D73).
 * Server errors keep their message (an error code such as `owner_only`) so the UI can map
 * it to copy; the server also queues the push to the other side on every change.
 */
export class SupabaseRideBookingRepository implements IRideBookingRepository {
  constructor(private readonly client: Client) {}

  async bookSeat(
    listingId: string,
    seats: number,
    requestedMeetingPoint?: Record<string, unknown> | null,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('book_ride_seat', {
      p_listing_id: listingId,
      p_seats: seats,
      p_requested_meeting_point: (requestedMeetingPoint ?? undefined) as never,
    });
    if (error) throw new Error(error.message);
    if (!data?.handoff_id) throw new Error('Failed to book seat');
    return data.handoff_id;
  }

  async listForRide(listingId: string): Promise<RideBooking[]> {
    const { data, error } = await this.client.rpc('list_ride_bookings', { p_listing_id: listingId });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((row) => {
      const booking = mapBookingRow(row);
      return booking ? [booking] : [];
    });
  }

  approve(handoffId: string): Promise<void> {
    return this.runHandoffRpc('confirm_ride_booking', handoffId);
  }

  decline(handoffId: string): Promise<void> {
    return this.runHandoffRpc('decline_ride_booking', handoffId);
  }

  cancel(handoffId: string): Promise<void> {
    return this.runHandoffRpc('cancel_ride_booking', handoffId);
  }

  complete(handoffId: string): Promise<void> {
    return this.runHandoffRpc('complete_ride_trip', handoffId);
  }

  async completeRide(listingId: string): Promise<number> {
    const { data, error } = await this.client.rpc('complete_ride_listing', { p_listing_id: listingId });
    if (error) throw new Error(error.message);
    return data ?? 0;
  }

  reinstate(handoffId: string): Promise<void> {
    return this.runHandoffRpc('reinstate_ride_booking', handoffId);
  }

  /** Every booking transition takes one handoff id and returns the updated row, unused here. */
  private async runHandoffRpc(fn: HandoffRpc, handoffId: string): Promise<void> {
    const { error } = await this.client.rpc(fn, { p_handoff_id: handoffId });
    if (error) throw new Error(error.message);
  }
}

/** Maps one `list_ride_bookings` row; a status outside the managed set is dropped. */
export function mapBookingRow(row: BookingRow): RideBooking | null {
  if (!isRideBookingListStatus(row.status)) return null;
  return {
    handoffId: row.handoff_id,
    recipientId: row.recipient_id,
    passengerName: row.passenger_name ?? '',
    avatarUrl: row.avatar_url ?? null,
    seats: row.seats,
    status: row.status,
    reservedAt: row.reserved_at,
    confirmBy: row.confirm_by ?? null,
    ratedByMe: row.rated_by_me === true,
    requestedStopLabel: (row as { requested_stop_label?: string | null }).requested_stop_label ?? null,
    cancelReason: (row as { cancel_reason?: string | null }).cancel_reason ?? null,
  };
}
