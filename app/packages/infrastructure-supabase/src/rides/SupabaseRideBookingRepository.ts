import type { SupabaseClient } from '@supabase/supabase-js';
import { isRideBookingListStatus, type RideBooking } from '@kc/domain';
import type { IRideBookingRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { requireRpcRow } from '../marketplace/rpcRow';

type Client = SupabaseClient<Database>;
type HandoffRow = Database['public']['Tables']['post_handoffs']['Row'];

/**
 * Ride seat bookings on `post_handoffs` (machine `ride_booking`, docs/spec/05_giving_worlds.md §5.3,
 * D73). A refusal is a stable reason (`BackendRuleError`, e.g. `seats_exhausted`), which the screens
 * map to copy; the server queues the push to the other side on every change.
 */
export class SupabaseRideBookingRepository implements IRideBookingRepository {
  constructor(private readonly client: Client) {}

  async bookSeat(
    listingId: string,
    seats: number,
    requestedMeetingPoint?: Record<string, unknown> | null,
  ): Promise<string> {
    const row = requireRpcRow(unwrapCall(
      'rpc:book_ride_seat',
      await this.client.rpc('book_ride_seat', {
        p_post_id: listingId,
        p_seats: seats,
        p_requested_meeting_point: (requestedMeetingPoint ?? undefined) as Json | undefined,
      }),
    ), 'book_ride_seat');
    return row.id;
  }

  /** The driver's view: every booking of the ride with the passenger's name and whether the driver rated them. */
  async listForRide(listingId: string): Promise<RideBooking[]> {
    const rows =
      unwrapCall(
        'table:post_handoffs',
        await this.client.from('post_handoffs').select('*').eq('post_id', listingId).order('created_at', { ascending: true }),
      ) ?? [];
    if (rows.length === 0) return [];
    const [users, ratings, viewerId] = await Promise.all([
      this.client.from('users').select('id, display_name, avatar_url').in('id', [...new Set(rows.map((r) => r.recipient_id))]),
      this.client.from('post_ratings').select('handoff_id').in('handoff_id', rows.map((r) => r.id)),
      sessionUserId(this.client),
    ]);
    const userById = new Map((unwrapCall('table:users', users) ?? []).map((u) => [u.id, u]));
    // The table shows a member only the ratings they wrote, so every returned row is "rated by me".
    const rated = new Set((viewerId ? (unwrapCall('table:post_ratings', ratings) ?? []) : []).map((r) => r.handoff_id));
    return rows.flatMap((row) => {
      const booking = mapBookingRow(row, userById.get(row.recipient_id) ?? null, rated.has(row.id));
      return booking ? [booking] : [];
    });
  }

  async approve(handoffId: string): Promise<void> {
    unwrapCall('rpc:confirm_ride_booking', await this.client.rpc('confirm_ride_booking', { p_handoff_id: handoffId }));
  }

  /** There is no separate decline: the driver cancelling a waiting booking declines it. */
  decline = (handoffId: string) => this.cancel(handoffId);

  async cancel(handoffId: string): Promise<void> {
    unwrapCall('rpc:cancel_ride_booking', await this.client.rpc('cancel_ride_booking', { p_handoff_id: handoffId }));
  }

  async complete(handoffId: string): Promise<void> {
    unwrapCall('rpc:complete_ride_trip', await this.client.rpc('complete_ride_trip', { p_handoff_id: handoffId }));
  }

  async reinstate(handoffId: string): Promise<void> {
    unwrapCall('rpc:reinstate_ride_booking', await this.client.rpc('reinstate_ride_booking', { p_handoff_id: handoffId }));
  }

  /** Completes the whole ride; resolves to the number of bookings completed. */
  async completeRide(listingId: string): Promise<number> {
    return unwrapCall('rpc:complete_ride', await this.client.rpc('complete_ride', { p_post_id: listingId })) ?? 0;
  }
}

/** The label of the meeting point a passenger asked for, when the stored document has one. */
function requestedStopLabel(point: Json | null): string | null {
  if (typeof point !== 'object' || point === null || Array.isArray(point)) return null;
  const label = point['label'];
  return typeof label === 'string' ? label : null;
}

/** Maps one handoff row; a status outside the managed set is dropped. */
export function mapBookingRow(
  row: HandoffRow,
  passenger: { display_name: string | null; avatar_url: string | null } | null,
  ratedByMe: boolean,
): RideBooking | null {
  if (!isRideBookingListStatus(row.status)) return null;
  return {
    handoffId: row.id,
    recipientId: row.recipient_id,
    passengerName: passenger?.display_name ?? '',
    avatarUrl: passenger?.avatar_url ?? null,
    seats: row.seats,
    status: row.status,
    reservedAt: row.created_at,
    confirmBy: row.confirm_by,
    ratedByMe,
    requestedStopLabel: requestedStopLabel(row.requested_meeting_point),
    cancelReason: row.cancel_reason,
  };
}
